---
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: [task-08, task-09]
blocks: [task-12]
requirement_ids: [FR-08, FR-09]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/change_writer/proxy.py
  - backend/app/modules/change_writer/router.py
  - backend/app/modules/change_writer/schema.py
  - backend/app/modules/change_writer/service.py
---

# Task-10 — change_writer proxy_create_change + proxy-create 端点 + service 改造

## 目标

为 daemon-client workspace 打通「从 UI 新建 change」通路（D-004@v1 lease-polling 代写）。新增 `proxy.py` 提供 `proxy_create_change`（runtime 校验 + 构造 change 包 + 下发 `daemon_change_writes` 任务 + 等 daemon 回执 + 落 Change/ChangeDocument 行）；新增 `POST /workspaces/{wid}/changes/proxy-create` 端点 + `ProxyCreateChangeRequest` schema；改造 `service.create_change` 使 daemon-client + runtime_id 走 proxy，无 runtime_id 抛结构化 `DaemonClientNoActiveSession` 替代裸 `requires active lease`。

依据：design §5.3 Phase 3 + §6 文件清单（proxy.py 新增 / service.py 改造 / router.py / schema.py）+ §7 接口定义（`DaemonClientNoActiveSession` + `proxy_create_change` 签名）+ §7.5 生命周期契约表（write_change 下发/回执 + proxy-create 离线 400）+ §8 错误码 `DAEMON_CLIENT_NO_SESSION`；plan task-10（覆盖 FR-08, FR-09）。

## implementation

### 1. `backend/app/modules/change_writer/proxy.py`（新增）

```python
class DaemonClientNoActiveSession(AppError):
    code = "DAEMON_CLIENT_NO_SESSION"
    http_status = 400

async def proxy_create_change(
    session: AsyncSession, *, workspace_id: UUID, user_id: UUID,
    runtime_id: UUID, title: str, description: str = "", change_type: str | None = None,
) -> Change: ...
```

流程：
1. **runtime 校验**：取 `workspace.daemon_runtime_id`，必须等于入参 `runtime_id` 且 runtime `status='online'`；不符抛 `DaemonClientNoActiveSession`（detail 引导文案「需要在线 daemon 才能在客户端工作区创建变更」）。workspace 非 daemon-client（`path_source`）同样不走 proxy（调用方 service 已分流，proxy 内仅做防御性 assert）。
2. **生成 change_key + 内容**：复用 service 既有算法（`datetime.now(UTC)` `%Y-%m-%d` + slug + `uuid.uuid4().hex[:6]`）；复用 `markdown_builder.build_master_md` + `_ensure_frontmatter` 逻辑构造 MASTER/proposal/request 文本（抽公共 helper 或直接调 `ChangeWriterService._ensure_frontmatter`，**不重复 frontmatter 逻辑**）。
3. **下发任务**：建一条 `DaemonChangeWrite`（task-08 模型）行 `status='pending'`、`runtime_id`、`workspace_id`、`change_key`、`files=[{path:"changes/<key>/MASTER.md", content}, ...]`（path 相对 spec_root，扁平布局 `changes/` 直接，无 `.sillyspec` 包裹）、`claim_token`。`commit()`。
4. **等回执**：轮询 `DaemonChangeWrite.status`（周期 ≤1s，task-09 端点消费 daemon claim/complete），超时 NFR-03 60s → 翻 `status='failed'` + 抛 `ChangeWriteError(detail=超时)`。
5. **落库**：回执 `ok=True` 后落 `Change`（`location='active'`、`path='changes/<key>'` 相对 spec_root）+ `ChangeDocument`（master，有 description 再加 proposal/request，path `changes/<key>/<file>`）行。`commit()` + `refresh(change)`。

### 2. `backend/app/modules/change_writer/service.py`

`create_change`（47-160）增 `runtime_id: uuid.UUID | None = None` 参数：
- `lease_id is not None` → 原 server-local 路径不变（lease worktree）。
- `lease_id is None` + workspace daemon-client + `runtime_id is not None` → 委托 `proxy_create_change(...)` 返回 Change（**不抛 `_repo_dir_for_workspace` 错误**）。
- `lease_id is None` + daemon-client + `runtime_id is None` → 抛 `DaemonClientNoActiveSession`（**替代** 现 `_repo_dir_for_workspace` 的 `requires an active lease` 裸抛，338-342）。
- server-local/repo-native 无 lease + 无 runtime → 原 `_repo_dir_for_workspace` 直写路径不变（零回归）。
- `generate_document` / `batch_generate_templates` 不动（仍要求 lease_id）。

### 3. `backend/app/modules/change_writer/router.py`

新增 `POST /changes/proxy-create`（response_model=`ChangeCreateResponse`，201）：解析 `ProxyCreateChangeRequest` → 调 `service.create_change(..., runtime_id=data.runtime_id)`。**不自动 dispatch brainstorm**（daemon-client change 暂不接 agent 流，与 server-local create_change 路径区分；agent dispatch 由 task-12/后续接）。

### 4. `backend/app/modules/change_writer/schema.py`

新增 `ProxyCreateChangeRequest`：`title: str (1..500)`、`description: str = "" (≤5000)`、`change_type: str | None`、`runtime_id: uuid.UUID`。

## acceptance

- daemon-client workspace + 在线 runtime：`proxy-create` 返回 201 + Change 行落库（path=`changes/<key>`），`daemon_change_writes` 状态收尾为 `done`。
- daemon-client + runtime 离线 / 无 runtime_id：返回 400 `DAEMON_CLIENT_NO_SESSION` + 引导 detail，前端可据结构化 code 渲染 toast。
- server-local `create_change(lease_id)` 零回归（既有路径与测试不受影响）。
- 超时（>60s 无回执）→ `daemon_change_writes.status='failed'` + 400。

## verify

```
cd backend && uv run pytest tests -k "change_writer or proxy_create or daemon_client" && uv run ruff check app/modules/change_writer
```

补：proxy_create_change 在线/离线/超时三条用例（daemon_change_writes + runtime mock），无 runtime 抛 DaemonClientNoActiveSession 测。

## constraints

- 复用 `markdown_builder` + `_ensure_frontmatter`，**不重复** frontmatter 逻辑（proxy.py 可 import ChangeWriterService 的 static helper 或抽公共函数）。
- 权限：复用 `get_current_user`；workspace 归属校验沿用 service 既有 `WorkspaceNotFound` 分支。变更写权限沿用既有 WORKSPACE_WRITE 约定（与 create_change 同）。
- **不破坏** server-local 的 `create_change(lease_id)` 路径（lease_id 分支完全保留）。
- daemon-client change 暂不自动 dispatch brainstorm agent（与 server-local create_change 的 auto-dispatch 区分；前端 task-12 负责接）。
- path 相对 spec_root 用扁平 `changes/<key>/`（无 `.sillyspec` 包裹，对齐 platform-managed 布局 D-005@v1）。
