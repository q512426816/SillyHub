---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-08
priority: P0
depends_on: [task-01, task-03]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/service.py
---

# Task-08 — `scan`/`scan-generate` daemon 派发 + create 跳过本地扫描

## 1. 任务概述

为 `path_source=daemon-client` 的 workspace 接通扫描执行链路：backend 不再尝试读取 daemon 客户端机器上的 `root_path`（读不到），改为把扫描/初始化工作派给**绑定 daemon** 在客户端执行；spec 产出经 FR-05（task-06 端点 + task-09 daemon 回传）回传服务器，落地到平台 `spec_root`（D-003@v1 真理源单一在服务器）。

本任务收敛两处改动：
1. **`service.create`**：daemon-client 时跳过 `_ensure_spec_workspace` 的本地 `shutil.copytree` 扫描分支（含前置的 `self.scan(root_path)` 本地校验），仅创建 SpecWorkspace 空壳；真正的 sillyspec 内容由后续 scan lease 派发到 daemon 产出再回填。
2. **`router.scan` / `scan-generate` / `rescan`**：判断 workspace（或请求）的 `path_source`，daemon-client 时调 `RunPlacementService.dispatch_to_daemon(stage='scan', ...)`（task-03 已实现按 `workspace.daemon_runtime_id` 强绑路由 + 离线抛 `NoOnlineDaemonError`），把 scan 工作派给绑定 daemon；server-local 维持现有 backend 本地 `WorkspaceScanner` 行为零变化。

**不在本任务范围**：bundle/sync 端点本身（task-06）、daemon 侧拉取/回传逻辑（task-09）、execution-context 的 spec_root 自决（task-07）、WS RPC 通道（task-04）、list_dir（task-05）。本任务只做 backend 路由层的 path_source 分支与派发调用，假设 task-03/06/09 接口已就位（接口契约见 §5）。

## 2. 修改文件清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/workspace/service.py` | `create`：daemon-client 分支跳过 `self.scan()` 本地校验 + `_ensure_spec_workspace` copytree（仅创建 SpecWorkspace 空壳 strategy=platform-managed）；`_resurrect_soft_deleted` 同步加 daemon-client 跳过；`activate` 同理；新增内部 helper `_is_daemon_client(payload_or_workspace)` |
| 修改 | `backend/app/modules/workspace/router.py` | `scan_workspace` / `scan_generate` / `rescan_workspace` 三个端点：判断 path_source，daemon-client 时走 dispatch scan 分支（调 `RunPlacementService.dispatch_to_daemon(stage='scan', ...)`），server-local 维持现有 `WorkspaceService.scan` / `scan_generate` / `rescan` |

唯一修改文件：`service.py` + `router.py`（`allowed_paths` 严格限定）。schema.py（`ScanRequest`/`ScanGenerateRequest` 加 `path_source` / `daemon_runtime_id` 可选字段，用于 `POST /scan`、`POST /scan-generate` 在 workspace 未创建前判断路径来源）**不在本任务范围**——若 router 需要这些字段，应在 task-01（schema 改动）或独立 sub-task 处理；本任务通过查 `Workspace` 表（`rescan` 已有 `workspace_id`）或新增 payload 字段（仅限 server-local 既有 `root_path` 场景的 dry-run scan）两种入口区分。**取舍**：`POST /scan`（dry-run，无 workspace 记录）保持纯 server-local 语义（**不接受 daemon-client**——dry-run 必须能读到本地文件才有意义）；只有 `scan-generate` / `rescan` / `create` 走 daemon-client 分支。详见 §5 决策。

## 3. 覆盖来源

| 来源 ID | 类型 | 摘要 | 本任务如何落实 |
|---|---|---|---|
| FR-06 | 功能需求 | 创建 daemon-client workspace 时跳过 `_ensure_spec_workspace` 本地 copytree；scan/scan-generate/reparse 判断 path_source，daemon-client 时 `dispatch_to_daemon(stage=scan)` 派给绑定 daemon，产出经 FR-05 sync 回传 | §5.1 create 跳过本地扫描；§5.2 router 三端点 path_source 分支 + dispatch scan |
| D-003@v1 | 决策 | spec 服务器平台托管：真理源始终为 backend `spec_root`；daemon 不长期持有副本 | dispatch scan 产出最终经 sync（task-06/09）覆盖服务器 `spec_root`；本任务不直接写 sync，但 create 时创建空壳 SpecWorkspace 占位 `spec_root={SPEC_DATA_ROOT}/{ws_id}` |
| design §5 Phase5 | 设计 | daemon-client workspace 的 scan/bootstrap/reparse 经 lease 派给绑定 daemon 执行；router.py 的 scan/scan-generate 端点判断 path_source | §5.2 router 分支逻辑 |
| design §6 文件清单 | 设计 | service.py create：daemon-client 跳过 `_ensure_spec_workspace`；router.py scan/scan-generate：daemon-client 改走 dispatch scan lease | §5.1 / §5.2 |
| design §9 兼容策略 | 设计 | `_ensure_spec_workspace` 本地 copytree 仅 server-local 执行；daemon-client 跳过 | §5.1 path_source 分支 |
| requirements FR-01（前置） | 依赖 | path_source 字段（task-01 已加） | 本任务读 `workspace.path_source` 字段做分支 |
| requirements FR-02（前置） | 依赖 | dispatch 强绑 daemon_runtime_id + 离线 fail（task-03 已实现） | §5.2 daemon-client 分支复用 task-03 的 dispatch_to_daemon 强绑路由 |

## 4. 实现要求

### 4.1 高层目标
1. `WorkspaceService.create`：payload.path_source=='daemon-client' 时**不调用** `self.scan(root_path)`（backend 读不到客户端路径，会抛 `WorkspacePathNotFound`），**不调用** `_ensure_spec_workspace`（其内部 `shutil.copytree` 同样失败）；改为直接创建 Workspace + 空 SpecWorkspace（spec_root 指向 `{SPEC_DATA_ROOT}/{ws_id}`，由后续 scan lease 派发产出填充）。
2. `_resurrect_soft_deleted`、`activate`：同步加 daemon-client 跳过分支（这两处也调 `self.scan()` + `_ensure_spec_workspace`）。
3. `router.scan_workspace`（`POST /scan` dry-run）：**维持纯 server-local 语义**——daemon-client workspace 没有「先创建再 dry-run」的入口（dry-run 本质是本地文件探测），此端点不改；若 payload 携带 daemon-client 标识，返回 400 提示「daemon-client workspace 请用 scan-generate」。
4. `router.scan_generate`（`POST /scan-generate`）：payload 或 workspace.path_source=='daemon-client' 时，跳过 `service.scan_generate` 内的本地 `_guard_path(root_path)`（backend 读不到），改为直接创建 pending Workspace（path_source=daemon-client, daemon_runtime_id 绑定）+ SpecWorkspace 空壳，然后调 `RunPlacementService.dispatch_to_daemon(stage='scan', root_path=<客户端路径>, workspace_id=..., workspace_name=..., workspace_slug=...)` 派给绑定 daemon 执行 sillyspec scan/init；产出经 task-09 daemon 端 sync 回传。
5. `router.rescan_workspace`（`POST /{id}/rescan`）：查 workspace，path_source=='daemon-client' 时**不调** `service.rescan`（内部 `self.scan(scan_path)` 读 backend 路径会失败或读到旧副本），改为 dispatch scan lease 派给绑定 daemon 重新扫描，产出 sync 回传服务器 spec_root + reparse。
6. server-local 全链路行为零变化（design §3 非目标、§9 兼容策略）。
7. 不引入新的 AppError 子类——复用 `NoOnlineDaemonError`（task-03 已加 runtime 标识字段）表达「绑定 daemon 离线」；router 捕获后转 503/504 给前端（与现有 scan-generate 离线失败的错误码对齐）。

### 4.2 文档同步
- `create` / `_resurrect_soft_deleted` / `activate` 加行内注释：`# FR-06 / D-003@v1：daemon-client 跳过本地 copytree（backend 读不到客户端路径）`。
- router 三端点加注释：path_source 分支 + dispatch scan 引用 design §5 Phase5。
- 不改模块级 docstring（模块用途不变）。

## 5. 接口定义（含伪代码）

### 5.1 `service.create` path_source 分支（跳过本地扫描）

现状（service.py:94-188）核心流程：`_find_active_by_root_path` → `self.scan(root_path)` → `_ensure_spec_workspace(...)`。

改造后（伪代码，仅展示新增分支）：

```python
async def create(
    self,
    payload: WorkspaceCreate,
    *,
    created_by: uuid.UUID | None,
) -> Workspace:
    slug = payload.slug or slugify(payload.name)
    now = datetime.now(UTC)

    existing = await self._find_active_by_root_path(payload.root_path)
    if existing:
        # ...现有激活逻辑不变（含 _ensure_spec_workspace_from_platform，该函数内部
        # 已 try local scan 兜底，对 daemon-client 会静默跳过——见 §6 B3）...
        return existing

    # ── FR-06 / D-003@v1：daemon-client 分支 ──────────────────────────
    if self._is_daemon_client_payload(payload):
        # backend 读不到客户端 root_path，跳过本地 scan + copytree。
        # 直接创建 Workspace（path_source/daemon_runtime_id 由 task-01 schema 已落库）
        # + 空 SpecWorkspace（spec_root 指向平台目录，内容由后续 scan lease 填充）。
        workspace = Workspace(
            id=uuid.uuid4(), name=payload.name, slug=slug,
            root_path=payload.root_path, status="active",
            path_source="daemon-client",                      # task-01 字段
            daemon_runtime_id=payload.daemon_runtime_id,      # task-01 字段
            component_key=payload.component_key, type=payload.type,
            role=payload.role, repo_url=payload.repo_url,
            default_branch=payload.default_branch,
            default_agent=payload.default_agent,
            default_model=payload.default_model,
            tech_stack=payload.tech_stack, build_command=payload.build_command,
            test_command=payload.test_command,
            source_yaml_path=payload.source_yaml_path,
            created_by=created_by, created_at=now, updated_at=now,
            last_scanned_at=now,
        )
        self._session.add(workspace)
        await self._session.flush()
        # 空 SpecWorkspace 占位（strategy=platform-managed，spec_root 平台目录）
        await self._ensure_empty_spec_workspace(workspace.id)
        await self._session.commit()
        await self._session.refresh(workspace)
        log.info(
            "workspace.created.daemon_client",
            workspace_id=str(workspace.id),
            daemon_runtime_id=str(workspace.daemon_runtime_id),
        )
        return workspace
    # ── server-local：现有逻辑零变化 ──────────────────────────────────

    # For new workspaces, scan local path for .sillyspec
    scan = self.scan(payload.root_path)                       # 现状不变
    # ...后续 _ensure_spec_workspace(workspace.id, scan.sillyspec_path) 不变...
```

新增 helper：

```python
@staticmethod
def _is_daemon_client_payload(payload: WorkspaceCreate) -> bool:
    """判断创建请求是否为 daemon-client 路径来源（FR-06）。

    task-01 schema validator 已保证 path_source='daemon-client' 时
    daemon_runtime_id 非空，此处只读字段不做二次校验。
    """
    return getattr(payload, "path_source", "server-local") == "daemon-client"

async def _ensure_empty_spec_workspace(self, workspace_id: uuid.UUID) -> None:
    """为 daemon-client workspace 创建空 SpecWorkspace 占位（无 .sillyspec 内容）。

    与 _ensure_spec_workspace 区别：不 copytree，只建记录，spec_root 指向
    {SPEC_DATA_ROOT}/{ws_id}（目录可不存在，由后续 scan lease 产出写入）。
    供 task-09 daemon sync 回传时覆盖。
    """
    from app.modules.spec_workspace.schema import SpecWorkspaceCreate
    from app.modules.spec_workspace.service import SpecWorkspaceService

    settings = get_settings()
    platform_root = f"{settings.spec_data_root}/{workspace_id}"
    spec_ws_svc = SpecWorkspaceService(self._session)
    try:
        await spec_ws_svc.get(workspace_id)  # 已存在则不重复建
    except Exception:
        await spec_ws_svc.create(
            workspace_id=workspace_id,
            payload=SpecWorkspaceCreate(
                spec_root=platform_root,
                strategy="platform-managed",
                repo_sillyspec_path=None,   # daemon-client 无 backend 可读的源路径
            ),
        )
```

`_resurrect_soft_deleted`（service.py:190-256）和 `activate`（service.py:934-952）同样加 `_is_daemon_client_*` 分支跳过 `self.scan()` + `_ensure_spec_workspace`，伪代码省略（结构同 create）。

### 5.2 `router.scan_generate` path_source 分支（dispatch scan）

现状（router.py:71-91）调 `service.scan_generate(...)`，其内部（service.py:771-876）做本地 `_guard_path` + `start_scan_dispatch`。`start_scan_dispatch` 内部现状已通过 `RunPlacementService.dispatch_to_daemon` 把 scan 派给 daemon，但：
- 它先调 `build_scan_bundle` 做 Workspace 存在性校验（service.py:946）
- 它的 `root_path` 校验 `work_dir.exists()`（service.py:934-939）——daemon-client 时 backend 读不到，**会抛 AgentRunError**

因此 scan-generate 的 daemon-client 分支需绕过 `service.scan_generate` 的本地路径校验，直接走「创建 pending workspace + dispatch scan lease」：

```python
@router.post("/scan-generate", response_model=ScanGenerateResponse)
async def scan_generate(
    payload: ScanGenerateRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> ScanGenerateResponse:
    service = WorkspaceService(session)

    # ── FR-06：daemon-client 分支 ──────────────────────────────────
    if service._is_daemon_client_payload(payload):  # payload 需带 path_source（见 §2 取舍注）
        # 注：ScanGenerateRequest 当前只有 root_path/provider/model（schema.py:53-68）。
        # daemon-client 标识由 payload.path_source 携带（需 task-01 同步扩 schema，
        # 或前端在 root_path 已是 daemon-client workspace 时走 rescan 入口）。
        workspace_id, agent_run_id = await service.scan_generate_daemon_client(
            root_path=payload.root_path,
            user_id=user.id,
            daemon_runtime_id=payload.daemon_runtime_id,
            provider=payload.provider,
            model=payload.model,
        )
        return ScanGenerateResponse(workspace_id=workspace_id, agent_run_id=agent_run_id)
    # ── server-local：现有逻辑零变化 ────────────────────────────────

    from app.modules.agent.service import AgentService
    agent_service = AgentService(session)
    workspace_id, agent_run_id = await service.scan_generate(
        root_path=payload.root_path, user_id=user.id,
        agent_service=agent_service,
        provider=payload.provider, model=payload.model,
    )
    return ScanGenerateResponse(workspace_id=workspace_id, agent_run_id=agent_run_id)
```

`service.scan_generate_daemon_client` 新增方法（伪代码）：

```python
async def scan_generate_daemon_client(
    self, *,
    root_path: str, user_id: uuid.UUID, daemon_runtime_id: uuid.UUID,
    provider: str | None = None, model: str | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """daemon-client scan-generate：创建 pending workspace + 派 scan lease 给绑定 daemon。

    与 scan_generate 区别：
      - 不做本地 _guard_path（backend 读不到客户端 root_path）
      - workspace.path_source='daemon-client', daemon_runtime_id 绑定
      - dispatch 强绑到 daemon_runtime_id（task-03 已在 dispatch_to_daemon 内实现）
      - 不调 build_scan_bundle（其内部读 spec_root 本地路径，daemon-client 时空壳）

    scan 产出由 daemon 端 sillyspec scan 生成 → task-09 postSpecSync 回传 →
    backend spec_root 覆盖 + reparse（D-003@v1 真理源在服务器）。
    """
    # 1. 幂等：同名 + 同 daemon_runtime 的 pending workspace 复用
    workspace = await self._find_active_by_root_path(root_path)
    if workspace is None:
        name = Path(root_path).name
        slug = await self._ensure_unique_slug(slugify(name))
        now = datetime.now(UTC)
        workspace = Workspace(
            id=uuid.uuid4(), name=name, slug=slug, root_path=root_path,
            status="pending", path_source="daemon-client",
            daemon_runtime_id=daemon_runtime_id,
            created_by=user_id, created_at=now, updated_at=now, last_scanned_at=now,
        )
        self._session.add(workspace)
        await self._session.flush()
        await self._ensure_empty_spec_workspace(workspace.id)

    # 2. 幂等：复用在途 scan run
    existing_run = await self._find_active_scan_run(workspace.id)
    if existing_run is not None:
        return (workspace.id, existing_run.id)

    # 3. 创建 AgentRun + dispatch scan lease 到绑定 daemon
    from app.modules.agent.model import AgentRun, AgentRunWorkspace
    from app.modules.agent.placement import RunPlacementService, NoOnlineDaemonError

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id, task_id=None, change_id=None, lease_id=None,
        agent_type="claude_code", provider=provider, model=model,
        status="pending", spec_strategy="platform-managed",
    )
    self._session.add(run)
    self._session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=workspace.id))
    await self._session.commit()
    await self._session.refresh(run)

    placement = RunPlacementService(self._session)
    # task-03 已让 dispatch_to_daemon 在 workspace.path_source='daemon-client' 时
    # 强绑 workspace.daemon_runtime_id（覆盖 user 级），离线抛 NoOnlineDaemonError。
    lease_id = await placement.dispatch_to_daemon(
        run.id, user_id,
        stage="scan",                              # daemon 端识别 scan 模式
        root_path=root_path,                       # 客户端真实路径，daemon 读取
        workspace_name=workspace.name,
        workspace_slug=workspace.slug,
        provider=provider, model=model,
        # spec_root 留空（task-07：daemon-client 时 backend 不传 backend 机器路径，
        # daemon 用 workspace_id 自行 bundle pull 到本地临时区）
    )
    if lease_id is None:
        # task-03 离线场景已抛 NoOnlineDaemonError；此处 None 兜底标记 failed
        await self._mark_scan_run_no_daemon(run, workspace.id, user_id)
    return (workspace.id, run.id)
```

### 5.3 `router.rescan_workspace` path_source 分支

现状（router.py:223-231）调 `service.rescan(workspace_id)`，内部 `self.scan(scan_path)`（service.py:289-326）读 backend 路径。daemon-client 时改为 dispatch scan lease：

```python
@router.post("/{workspace_id}/rescan", response_model=ScanResponse)
async def rescan_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> ScanResponse:
    service = WorkspaceService(session)
    workspace = await service.get(workspace_id)  # 抛 WorkspaceNotFound if missing

    # ── FR-06：daemon-client 分支 ──────────────────────────────────
    if workspace.path_source == "daemon-client":
        # 派 scan lease 给绑定 daemon 重新扫描；产出 sync 回传服务器 spec_root
        # 后，再从服务器 spec_root 读 ScanResult 返回（D-003@v1 真理源在服务器）。
        await service.rescan_via_daemon(workspace_id, user_id=_user.id)
        # rescan_via_daemon 内部 dispatch + 等待 sync 完成（或返回 lease_id 异步），
        # 然后从服务器 spec_root 重新构造 ScanResult（复用 server-local rescan 的读取逻辑）
        _, scan = await service._scan_from_platform_spec(workspace_id)
        return _build_scan_response(scan)
    # ── server-local：现有逻辑零变化 ────────────────────────────────

    _, scan = await service.rescan(workspace_id)
    return _build_scan_response(scan)
```

`service.rescan_via_daemon` / `_scan_from_platform_spec` 新增方法（伪代码略，结构同 scan_generate_daemon_client：dispatch stage='scan' → 等 sync → 从服务器 spec_root 读 ScanResult）。

### 5.4 `router.scan_workspace`（POST /scan dry-run）—— 不改

`POST /scan` 是 workspace 未创建前的纯本地 dry-run（router.py:61-68），语义是「backend 探测这个本地路径是不是 sillyspec workspace」。daemon-client 路径 backend 读不到，dry-run 无意义。**决策**：此端点不改，若未来前端需要对 daemon-client 路径做 dry-run，走 task-04 list_dir RPC 探测 `.sillyspec` 目录存在性即可（属 task-04/task-11 范围）。本任务在 `ScanRequest` 不加 path_source 字段，保持 dry-run 纯 server-local。

## 6. 边界处理（≥5 条）

| 编号 | 边界场景 | 输入示例 | 期望行为 | 实现位置 |
|---|---|---|---|---|
| B1 | server-local workspace 全链路零变化 | 现有 workspace（path_source 默认 server-local 或 NULL）走 create/scan-generate/rescan | 行为与改动前完全一致：`self.scan()` 本地校验 + `_ensure_spec_workspace` copytree + `service.scan_generate` 本地路径校验 + `start_scan_dispatch`；router 不进 daemon-client 分支 | `_is_daemon_client_payload` 返回 False → 走原路径 |
| B2 | daemon-client create：backend 读不到客户端 root_path | payload.path_source='daemon-client', root_path='C:\Users\qinyi\IdeaProjects\xxx'（daemon 机器路径） | **不调** `self.scan(root_path)`（会抛 WorkspacePathNotFound）；直接建 Workspace + 空 SpecWorkspace；返回 201；scan 产出由后续 scan-generate/rescan lease 派发产出 | `create` daemon-client 分支 |
| B3 | daemon-client workspace 激活/复活时 `_ensure_spec_workspace_from_platform` 兜底本地 scan | existing workspace 是 daemon-client，create 命中 `_find_active_by_root_path` 走激活分支 | `_ensure_spec_workspace_from_platform`（service.py:956-997）内部 `except: pass` + 末尾 `self.scan(workspace.root_path)` 对 daemon-client 会抛异常但被外层 try 吞？——**需审计**：现状该函数末尾 `scan = self.scan(workspace.root_path)` 无 try 包裹（service.py:995），daemon-client 会抛 `WorkspacePathNotFound`。**应对**：在 `_ensure_spec_workspace_from_platform` 入口加 `if workspace.path_source=='daemon-client': return`（跳过整个函数），见 §5.1 helper 同源处理 | `_ensure_spec_workspace_from_platform` 入口守卫 |
| B4 | 绑定 daemon 离线时 scan-generate/rescan | workspace.daemon_runtime_id 指向的 runtime status='offline' | `dispatch_to_daemon`（task-03）抛 `NoOnlineDaemonError` 携 runtime 标识；router 捕获 → 置 AgentRun.status='failed', error_code='no_online_daemon'；返回 503 + 错误体含 runtime 标识，前端提示「目标 daemon 离线，请启动」（FR-02 一致） | router try/except NoOnlineDaemonError + `_mark_scan_run_no_daemon` |
| B5 | scan lease 超时 / daemon 中途离线 | dispatch 成功但 daemon claim 后执行 sillyspec scan 超时（如大仓库） | lease 有 timeout（task-03 既有机制），daemon 端 task-runner 超时 → lease 状态变 failed/expired；scan-generate 返回的 agent_run_id 异步轮询发现 failed；前端轮询 `/agent-runs/{id}` 看到 failed + error。**本任务不新增超时逻辑**，复用 task-03 lease 机制 | 复用 task-03 |
| B6 | daemon-client rescan 时服务器 spec_root 为空（首次 rescan，scan 从未成功过） | workspace 创建后 scan lease 从未成功，spec_root 目录不存在 | `rescan_via_daemon` 仍派 lease（让 daemon 重新扫描）；`_scan_from_platform_spec` 读空目录时返回 `ScanResult(is_sillyspec=False, warnings=['no_sillyspec_dir'])`，不抛异常；前端据此提示「尚未扫描成功，请确认 daemon 在线后重试」 | `_scan_from_platform_spec` 容错 |
| B7 | reparse（service.reparse, service.py:523）对 daemon-client workspace | daemon-client workspace 调 generate-projects/reparse | `reparse` 内部读 `spec_root`（service.py:549-553）从 SpecWorkspace 取，daemon-client 时 spec_root 是服务器平台目录（已由 sync 回传填充）；若 sync 未完成 spec_root 为空/不存在 → 走 `root_path = _rewrite_path(ws.root_path)` 兜底（service.py:553）→ daemon-client 时这是客户端路径，backend 读不到 → 抛异常。**应对**：reparse 入口加 daemon-client 守卫「spec_root 未就绪时拒绝并提示先完成 scan」，或文档约定 reparse 仅在 scan sync 完成后调用。**本任务范围**：只在 create/scan-generate/rescan 加分支；reparse/generate-projects 的 daemon-client 守卫作为已知遗留，记 §9 风险，不在本任务实现 | reparse 守卫 = 遗留 |
| B8 | path_source 字段缺失（旧数据 / 直接构造 payload） | workspace.path_source is NULL（理论上 task-01 默认 server-local 不会 NULL，但防御） | `_is_daemon_client_*` 用 `getattr(..., 'path_source', 'server-local')` 兜底，None/缺失均按 server-local 处理 | helper 实现 |
| B9 | daemon-client scan-generate 幂等：同 root_path + 同 daemon 重复请求 | 用户连续点两次 scan-generate | `_find_active_by_root_path` 命中已有 pending workspace → 复用；`_find_active_scan_run` 命中在途 run → 返回同一 agent_run_id（与 server-local scan_generate 幂等行为一致，service.py:841-850） | scan_generate_daemon_client 幂等检查 |

## 7. TDD（测试用例）

遵循 CLAUDE.md「写测试 → 写实现」。测试文件：`backend/app/modules/workspace/tests/test_service.py`（已存在）+ `test_router.py`（已存在）追加用例。

| 用例 ID | 场景 | 输入 | 期望 | 对应边界 |
|---|---|---|---|---|
| T1 | server-local create 零回归 | payload 无 path_source（默认 server-local），root_path 指向本地真实 sillyspec 目录 | 走原路径：`scan()` 成功 + `_ensure_spec_workspace` copytree 执行 + spec_root 有 .sillyspec；行为与改动前字节级一致 | B1 |
| T2 | daemon-client create 跳过本地 scan | payload.path_source='daemon-client', daemon_runtime_id=<uuid>, root_path='/nonexistent/on/backend'（backend 读不到） | 不抛 WorkspacePathNotFound；Workspace 创建成功 path_source/daemon_runtime_id 落库；SpecWorkspace 创建 strategy=platform-managed, spec_root={SPEC_DATA_ROOT}/{ws_id}；**不**执行 copytree（spec_root 目录无 .sillyspec 或不存在） | B2 |
| T3 | daemon-client create 不调 WorkspaceScanner | mock WorkspaceService._scanner.scan，daemon-client create | `_scanner.scan` 调用次数为 0 | B2 |
| T4 | daemon-client create 后服务器 spec_root 为空壳 | T2 完成后读 spec_root 目录 | 目录不存在或为空（无 .sillyspec），待 scan lease 填充 | B2/B6 |
| T5 | daemon-client scan-generate dispatch scan lease | mock RunPlacementService.dispatch_to_daemon，daemon-client scan-generate | dispatch_to_daemon 被调用 1 次，参数 stage='scan', root_path=<客户端路径>, workspace_name/slug 透传；返回 agent_run_id；AgentRun.status='pending' | §5.2 |
| T6 | daemon-client scan-generate 绑定 daemon 离线 | mock dispatch_to_daemon 抛 NoOnlineDaemonError(runtime_id=...) | router 捕获 → AgentRun.status='failed', error_code='no_online_daemon'；HTTP 503；错误体含 runtime_id | B4 |
| T7 | daemon-client scan-generate 幂等 | 同 root_path 连续两次 scan-generate | 第二次返回同一 workspace_id + agent_run_id（命中 _find_active_scan_run） | B9 |
| T8 | daemon-client rescan 走 dispatch 不走本地 scan | workspace.path_source='daemon-client'，POST /{id}/rescan | service.rescan（本地 scan）**不**被调用；rescan_via_daemon 被调用 → dispatch stage='scan' | §5.3 |
| T9 | server-local rescan 零回归 | workspace.path_source='server-local'，POST /{id}/rescan | 走 service.rescan 本地 scan；行为不变 | B1 |
| T10 | `_ensure_spec_workspace_from_platform` 对 daemon-client 跳过 | workspace.path_source='daemon-client' 调用该函数 | 函数立即 return（不执行末尾 self.scan）；不抛异常 | B3 |
| T11 | daemon-client rescan 服务器 spec_root 空时返回 not sillyspec | workspace 无成功 scan 记录，spec_root 不存在 | rescan_via_daemon 仍派 lease；_scan_from_platform_spec 返回 is_sillyspec=False + warning；不抛异常 | B6 |
| T12 | path_source 缺失按 server-local 处理 | workspace.path_source=None（手动构造） | _is_daemon_client_* 返回 False，走 server-local 路径 | B8 |
| T13 | POST /scan（dry-run）不接受 daemon-client | payload 携带 path_source='daemon-client'（若 schema 扩了字段） | 维持纯 server-local：若 backend 读不到 root_path 抛 WorkspacePathNotFound（现状行为）；或返回 400 提示用 scan-generate（见 §5.4 取舍，实现选其一并测试） | §5.4 |

TDD 顺序：T1/T9（server-local 零回归，最重要）先行 → T2/T3/T4（create 跳过）→ T5/T7（scan-generate dispatch）→ T6（离线 fail）→ T8/T11（rescan）→ T10（from_platform 守卫）→ T12/T13（边界兜底）。

## 8. 验收标准（对照需求/决策）

| 验收点 | 来源 | 验证方式 | 通过条件 |
|---|---|---|---|
| AC-1 server-local workspace create/scan-generate/rescan 全链路行为零变化 | design §3 非目标 / §9 兼容策略 / FR-06「server-local 维持现有」 | 现有 test_service.py / test_router.py 全绿 + 手动跑一遍 | 既有用例 0 失败；新增 daemon-client 用例不影响既有断言 |
| AC-2 daemon-client create 跳过本地 copytree | FR-06「跳过 _ensure_spec_workspace 本地 copytree」 | T2/T3/T4 | WorkspaceScanner.scan 调用 0 次；spec_root 无 .sillyspec 内容；不抛路径异常 |
| AC-3 daemon-client create 落库 path_source + daemon_runtime_id | FR-01（task-01 前置）/ D-004@v1 | T2 后查 DB | workspace.path_source='daemon-client'; daemon_runtime_id 等于 payload 值 |
| AC-4 daemon-client scan-generate 派 scan lease 到绑定 daemon | FR-06「dispatch_to_daemon(stage=scan) 派给绑定 daemon」/ D-001@v1 | T5 | dispatch_to_daemon 调用 1 次，stage='scan'，runtime 强绑 workspace.daemon_runtime_id（task-03 行为） |
| AC-5 绑定 daemon 离线时 scan-generate 失败 + 提示 runtime | FR-02（task-03 前置）/ D-001@v1 | T6 | NoOnlineDaemonError 捕获；HTTP 503；错误体含 runtime 标识；AgentRun.status='failed' |
| AC-6 daemon-client rescan 走 dispatch 不走本地 WorkspaceScanner | FR-06「reparse 同理」/ design §5 Phase5 | T8 | service.rescan 未调用；dispatch stage='scan' 调用 1 次 |
| AC-7 daemon-client rescan 服务器 spec_root 空时优雅降级 | 本任务 B6 | T11 | 不抛异常；返回 is_sillyspec=False + warning |
| AC-8 `_ensure_spec_workspace_from_platform` 对 daemon-client 不抛 | 本任务 B3 | T10 | 函数对 daemon-client workspace 立即 return；现有 server-local 调用行为不变 |
| AC-9 path_source 缺失/NULL 按 server-local 兜底 | 本任务 B8 / design §9 | T12 | 走 server-local 路径，不抛 AttributeError |
| AC-10 scan 产出真理源回服务器（D-003@v1 端到端） | D-003@v1 / FR-05（task-06/09 协作） | 集成测试（依赖 task-06/09）：daemon-client scan-generate → daemon 执行 sillyspec scan → postSpecSync → backend spec_root 覆盖 + reparse → 前端列表读服务器 spec_root 看到 scan 产出 | spec_root 有 .sillyspec 内容；scan_docs reparse 生效；本任务只保证 dispatch 发起 + 服务器读路径正确，sync 回传由 task-06/09 保证 |
| AC-11 不引入非 allowed_paths 文件改动 | 本任务边界 | `git diff --name-only` | 仅 `backend/app/modules/workspace/router.py` + `service.py`（+ 对应 test 文件） |
| AC-12 backend lint + 测试通过 | 项目规约 | `uv run ruff check . && uv run pytest` | 0 lint error；测试全绿（含新增 T1~T13） |
| AC-13 scan-generate 幂等（daemon-client） | 本任务 B9 | T7 | 重复请求返回同一 agent_run_id |

## 9. 风险与备注

- **R-1（schema 扩字段归属）**：`ScanGenerateRequest` 当前无 path_source/daemon_runtime_id 字段（schema.py:53-68）。daemon-client scan-generate 需要这两个字段。**取舍**：本任务 `allowed_paths` 严格限定不含 schema.py，故字段扩展归属 task-01（schema 已在那里改 WorkspaceCreate/Update/Read，顺带 ScanGenerateRequest）。**若 task-01 未覆盖 ScanGenerateRequest**，需在执行阶段确认归属：要么本任务临时扩 allowed_paths 加 schema.py，要么 task-01 补字段。**建议**：task-01 蓝图应显式包含 ScanGenerateRequest.path_source/daemon_runtime_id（向 task-01 反馈此依赖）。本任务伪代码假设字段已就位。
- **R-2（reparse/generate-projects daemon-client 守卫 = 遗留）**：`service.reparse`（service.py:523）和 `generate_projects`（service.py:381）对 daemon-client workspace 在 spec_root 未就绪时会兜底读客户端 root_path 失败（B7）。本任务不实现守卫，记为已知遗留：约定 reparse/generate-projects 仅在 scan sync 完成后由前端/用户调用；或后续独立任务加守卫。**影响**：daemon-client workspace 在 scan 未成功时调 reparse 会抛异常，但不阻塞核心 scan 派发链路。
- **R-3（dispatch scan 的产出回传依赖 task-06/09）**：本任务只负责把 scan 工作派给 daemon（dispatch lease）。daemon 端执行 sillyspec scan 的产出如何回传服务器 spec_root 是 task-09（postSpecSync）+ task-06（POST /sync 端点）的职责。本任务 AC-10 的端到端验收**依赖** task-06/09 完成；单独验收本任务时，AC-10 降级为「dispatch 正确发起 + 服务器读路径正确」，sync 回传由 task-06/09 独立验收。
- **R-4（rescan 同步 vs 异步）**：`rescan_via_daemon` 派 lease 后，daemon 执行 scan + sync 是异步的。`POST /{id}/rescan` 现状是同步返回 ScanResponse（router.py:223-231）。daemon-client 时若等 sync 完成再返回，HTTP 请求会长时间挂起（scan 大仓库可能几十秒）。**取舍**：本任务实现「派 lease + 立即从当前服务器 spec_root 读 ScanResult 返回」（可能返回旧/空结果），前端轮询 agent_run 状态 + sync 完成后刷新；或返回 202 + lease_id 让前端轮询。**建议**：返回当前服务器 spec_root 的 ScanResult（可能 stale）+ 在 response 加 `scan_in_progress: true` 标记，前端据此轮询。具体 response schema 扩展不在本任务（response_model=ScanResponse 不变，避免破坏前端契约），stale 结果可接受（D-003 真理源在服务器，sync 完成后前端刷新即最新）。
- **R-5（POST /scan dry-run 对 daemon-client 的处理）**：§5.4 决策保持纯 server-local。若前端需要对 daemon-client 路径做 dry-run（如创建前探测 .sillyspec 是否存在），应走 task-04 list_dir RPC（探测 .sillyspec 子目录），不在本任务范围。本任务在 `ScanRequest` 不加 path_source，若 payload 误带该字段，pydantic 默认忽略（extra=ignore），行为=server-local dry-run，backend 读不到客户端路径时抛 WorkspacePathNotFound（现状行为）。
- **R-6（task-03 接口契约）**：本任务伪代码假设 task-03 已让 `dispatch_to_daemon` 在 workspace.path_source='daemon-client' 时强绑 `workspace.daemon_runtime_id`（覆盖 `_get_online_runtime(user_id)` 的 user 级选择，placement.py:174 现状）。**需在 task-03 蓝图确认**：dispatch_to_daemon 内部读 workspace 表的 path_source/daemon_runtime_id 字段做路由决策（而非仅靠传入参数）。本任务的 dispatch 调用不显式传 runtime_id（依赖 task-03 内部按 workspace 自决），与 FR-02 一致。
- **R-7（build_scan_bundle 的 Workspace 存在性校验）**：现状 `start_scan_dispatch` 调 `build_scan_bundle`（service.py:946）做 Workspace 校验副作用。本任务 `scan_generate_daemon_client` **不调** start_scan_dispatch（绕过本地路径校验），故也不调 build_scan_bundle。**需确认**：build_scan_bundle 是否有 daemon 端必需的副作用（如写 lease metadata）？从 service.py:944-952 注释看「返回值不再本地使用，仅消费 Workspace 存在性校验副作用」，daemon 端经 execution-context 自行重建 bundle（task-07），故本任务跳过 build_scan_bundle 安全。

## 10. 出参检查清单（执行阶段自检）

- [ ] `backend/app/modules/workspace/router.py` + `service.py` 是唯一改动的源文件（test 文件除外）
- [ ] `create` / `_resurrect_soft_deleted` / `activate` / `_ensure_spec_workspace_from_platform` 均有 daemon-client 跳过分支
- [ ] `_is_daemon_client_payload` / `_is_daemon_client_workspace` helper 私有，纯字段读取
- [ ] `_ensure_empty_spec_workspace` 不执行 copytree，spec_root 指向平台目录
- [ ] `scan_generate_daemon_client` / `rescan_via_daemon` dispatch stage='scan' 调用正确
- [ ] router 三端点（scan/scan-generate/rescan）path_source 分支齐全（scan 维持 server-local）
- [ ] NoOnlineDaemonError 捕获 → AgentRun failed + HTTP 503 + runtime 标识
- [ ] server-local 全链路既有测试 0 回归
- [ ] 新增 T1~T13 全绿
- [ ] `uv run ruff check . && uv run pytest` 通过
- [ ] 行内注释引用 FR-06 / D-003@v1 / design §5 Phase5
