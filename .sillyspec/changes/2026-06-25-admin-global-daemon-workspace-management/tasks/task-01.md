---
id: task-01
title: 增加后端权限、筛选分页、别名与路由顺序测试
priority: P0
estimated_hours: 3
depends_on: []
blocks: [task-03, task-04, task-05, task-09]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/**
  - backend/app/modules/workspace/tests/**
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-01.md
author: qinyi
created_at: "2026-06-25 17:48:59"
---

# task-01: 增加后端权限、筛选分页、别名与路由顺序测试

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/daemon/tests/test_runtime_admin_management.py` | 覆盖 daemon runtime 平台管理员全局视图、普通账号隔离、分页筛选、别名 PATCH、跨 owner 管理、`/runtimes/page` 路由顺序和旧 `/runtimes` 数组兼容。 |
| 新增 | `backend/app/modules/workspace/tests/test_workspace_admin_management.py` | 覆盖 workspace 平台管理员全局视图、普通账号 `user_id` 不越权、`q/type/status/limit/offset`、owner DTO 和 `display_alias` PATCH。 |

> 本任务只新增/调整测试，不修改生产代码、schema、migration 或前端文件。测试允许在 task-03、task-04、task-05 完成前保持红灯，但失败原因必须指向本变更缺失能力，而不是夹具或测试写法错误。

## 覆盖来源

- `requirements.md`：FR-01 平台管理员全局查看与操作资源；FR-02 普通账号权限边界不扩大；FR-03 runtime/workspace 独立 `display_alias`；FR-04 服务端 `q/type/status/limit/offset`；FR-06 旧调用兼容。
- `design.md`：Phase 2 daemon `/api/daemon/runtimes/page` 与 workspace 列表筛选分页；Phase 3 runtime 别名与跨 owner 管理；接口定义 7.1-7.4；兼容策略与风险 R-02/R-03/R-07。
- `decisions.md`：D-001 平台管理员沿用 `is_platform_admin` 全权限短路；D-002 别名不覆盖原始名称；D-003 `user_id` 仅平台管理员生效；D-005 固定路径必须先于动态 UUID 路径；D-006 owner 使用嵌套 `OwnerRead`。
- `plan.md`：Wave 1 的 task-01 是 task-03/04/05/09 前置测试任务，阻塞后续后端实现与后端回归。
- 模块文档：`.sillyspec/docs/backend/modules/daemon.md`、`workspace.md`、`auth.md`、`admin.md`；代码约定来自 `.sillyspec/docs/backend/scan/CONVENTIONS.md` 和 `ARCHITECTURE.md`。

## 实现要求

1. 新增 daemon HTTP/服务测试文件 `backend/app/modules/daemon/tests/test_runtime_admin_management.py`，优先走 `httpx.AsyncClient` + `auth_headers` 或自建 JWT headers，复用 `backend/conftest.py` 的内存 SQLite、`client`、`db_session` 夹具。
2. daemon 测试必须显式造三个用户：平台管理员、普通用户 A、普通用户 B。管理员使用 `is_platform_admin=True`；普通用户必须是 `is_platform_admin=False`，并授予足以访问 runtime 管理端点的 `runtime:admin` 权限，避免 403 掩盖查询边界。
3. daemon 测试必须覆盖平台管理员 `GET /api/daemon/runtimes/page` 可看到 A/B 的 runtime，且每条 item 包含 `owner.user_id`、`owner.email`、`owner.display_name`；普通用户 A 即使传 `user_id=B` 也只能看到 A 自己的 runtime。
4. daemon 测试必须覆盖 `q/type/status/limit/offset`：`q` 大小写不敏感匹配 `display_alias`、`name`、`provider` 或稳定标识字段；`type` 映射 runtime `provider` 精确过滤；`status` 精确过滤；`total` 是过滤后分页前总数；`items` 只返回当前页。
5. daemon 测试必须覆盖 `PATCH /api/daemon/runtimes/{runtime_id}` 设置、读取、清空 `display_alias`，并验证别名不会改写 `name`/`provider`。
6. daemon 测试必须覆盖平台管理员可对非本人 runtime 执行 `disable`、`enable`、`delete`；同时保留已绑定未软删 workspace 删除返回 409 的保护，不能因为平台管理员短路绕过 `DaemonRuntimeInUse`。
7. daemon 测试必须覆盖 `GET /api/daemon/runtimes/page` 固定路由返回 200 分页对象，不能被 `/runtimes/{runtime_id}` 动态 UUID 路由捕获为 422；测试名建议包含 `route_order` 或 `not_captured_by_runtime_id`。
8. daemon 测试必须覆盖旧 `GET /api/daemon/runtimes` 仍返回数组 `list[DaemonRuntimeRead]`，响应不能变成 `{items,total}`；该测试是 FR-06 兼容门。
9. 新增 workspace HTTP/服务测试文件 `backend/app/modules/workspace/tests/test_workspace_admin_management.py`，可直接插入 `Workspace` 行以避开文件系统 scan，仅在需要验证 router PATCH 时走 HTTP。
10. workspace 测试必须显式造平台管理员、普通用户 A、普通用户 B，并为普通用户 A 只授予部分 workspace 的 `workspace:read` 或 `workspace:admin` 角色，验证普通账号可见性来自 `allowed_workspace_ids()`，不是来自请求参数。
11. workspace 测试必须覆盖平台管理员 `GET /api/workspaces` 可看到 A/B 创建的未删除 workspace，并可通过 `user_id=B` 只筛 B 创建的 workspace；普通用户 A 传 `user_id=B` 时仍只能看到 A 被授权的 workspace。
12. workspace 测试必须覆盖 `q/type/status/limit/offset`：`q` 大小写不敏感匹配 `display_alias`、`name`、`slug`、`root_path` 或关键标识字段；`type` 精确匹配 workspace `type` 或 `path_source` 约定；`status` 精确过滤；`total` 先过滤再分页。
13. workspace 测试必须覆盖 `PATCH /api/workspaces/{workspace_id}` 设置、读取、清空 `display_alias`，并验证原始 `name`、`slug`、`root_path` 不被别名覆盖。
14. owner DTO 验证必须使用嵌套结构：`owner is None` 或 `owner == {"user_id": ..., "email": ..., "display_name": ...}`；不得新增扁平字段断言如 `owner_email`。
15. 测试文件中的 helper 命名应短而明确，例如 `_create_user`、`_auth_headers_for`、`_grant_platform_permission`、`_grant_workspace_permission`、`_create_runtime`、`_create_workspace_row`；不要改动 `backend/conftest.py`。
16. 如果执行阶段发现生产代码尚无 `display_alias` 字段导致测试 collection 失败，可在测试中用 `pytest.mark.xfail` 临时标注具体缺失点，但本 task 合并时优先保留普通失败测试，让 task-03/04/05 按 TDD 转绿。

## 接口定义

目标后端契约由本任务测试锁定：

```http
GET /api/daemon/runtimes/page?q=&type=&status=&user_id=&limit=12&offset=0
PATCH /api/daemon/runtimes/{runtime_id}
GET /api/daemon/runtimes
POST /api/daemon/runtimes/{runtime_id}/disable
POST /api/daemon/runtimes/{runtime_id}/enable
DELETE /api/daemon/runtimes/{runtime_id}
GET /api/workspaces?q=&type=&status=&user_id=&limit=12&offset=0
PATCH /api/workspaces/{workspace_id}
```

分页响应测试契约：

```python
class OwnerRead(BaseModel):
    user_id: uuid.UUID | None
    email: str | None
    display_name: str | None

class DaemonRuntimeListResponse(BaseModel):
    items: list[DaemonRuntimeRead]
    total: int
    limit: int
    offset: int

class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceRead]
    total: int
```

别名更新请求测试契约：

```json
{"display_alias": "生产环境主 daemon"}
{"display_alias": null}
```

旧 daemon 列表兼容契约：

```python
resp = await client.get("/api/daemon/runtimes", headers=headers)
assert resp.status_code == 200
assert isinstance(resp.json(), list)
```

## 边界处理

1. **平台管理员全局短路不等于跳过业务保护**：admin 可跨 owner disable/enable/delete runtime，但 delete 被未软删 workspace 绑定时仍必须 409，沿用 `DaemonRuntimeInUse`。
2. **普通账号传 `user_id` 不扩大范围**：runtime 普通账号仍按 `DaemonRuntime.user_id == current_user.id`；workspace 普通账号仍按 `allowed_workspace_ids(current_user, workspace:read)`，`user_id` 查询参数被忽略或只在已授权集合内收敛。
3. **`q` 大小写不敏感且包含别名回退字段**：测试数据要包含大小写混合别名、原始名称和 provider/slug/root_path，避免实现只查其中一个字段仍误过。
4. **`type`/`status` 精确过滤**：`type=codex` 不能匹配 `claude-code`；`status=disabled` 不能返回 `online/offline/active`，workspace 的 `type` 与 `path_source` 约定需在测试名或注释写清。
5. **分页 total 不是当前页长度**：准备至少 3 条命中数据，用 `limit=1&offset=1` 验证 `len(items)==1` 且 `total==3`。
6. **空别名与清空别名**：`display_alias` 初始 `None` 时读接口返回 `null`；PATCH 字符串后返回该值；PATCH `null` 后恢复 `null`，原始 `name`/`slug`/`provider` 不变。
7. **owner 为空可序列化**：workspace `created_by=None` 或 runtime owner 查不到时，列表不应 500；对应 item 的 `owner` 允许为 `null`。
8. **固定路由顺序**：`/api/daemon/runtimes/page` 必须返回 200 分页对象；若返回 422 且 detail 指向 UUID path parse，说明被动态路由抢占，测试必须失败。
9. **旧数组端点兼容**：新增分页对象只能出现在 `/runtimes/page`；旧 `/runtimes` 继续是数组，避免破坏现有前端 `listDaemonRuntimes()`。
10. **权限失败与过滤为空区分**：普通用户有访问端点所需权限但无匹配资源时应返回 200 空列表，而不是 403；没有权限的用户仍由现有依赖返回 403，不在本任务扩展。

## 非目标

- 不新增或修改 migration；`display_alias` 数据库列由 task-03 负责。
- 不修改 daemon/workspace 生产实现；分页、owner JOIN、跨 owner 管理由 task-04/task-05 负责。
- 不修改 `backend/conftest.py`、auth/admin 生产代码或通用测试夹具。
- 不覆盖前端 API client、页面交互或卡片样式；这些由 task-02、task-06、task-07、task-08 负责。
- 不改变 session、lease、heartbeat、workspace scan/rescan 生命周期。
- 不把旧 `/api/daemon/runtimes` 响应改成分页对象。

## 参考

- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/requirements.md`
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md`
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/decisions.md`
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/plan.md`
- `.sillyspec/docs/backend/scan/CONVENTIONS.md`
- `.sillyspec/docs/backend/scan/ARCHITECTURE.md`
- `.sillyspec/docs/backend/modules/daemon.md`
- `.sillyspec/docs/backend/modules/workspace.md`
- `.sillyspec/docs/backend/modules/auth.md`
- `.sillyspec/docs/backend/modules/admin.md`
- `backend/conftest.py`：`db_session`、`client`、`auth_headers`、内存 SQLite fixture。
- `backend/app/modules/daemon/router.py`：现有 `/runtimes/usage` 静态路由顺序注释、旧 `/runtimes` 数组端点、动态 `/runtimes/{runtime_id}`。
- `backend/app/modules/daemon/runtime/service.py`：现有 owner guard、`delete_runtime` 绑定 workspace 409 保护。
- `backend/app/modules/daemon/tests/test_lease_service.py`：runtime helper、跨 owner not found、绑定 workspace delete 409 风格。
- `backend/app/modules/workspace/router.py`：当前平台管理员全量分支、普通账号 `allowed_workspace_ids` 分支。
- `backend/app/modules/workspace/tests/test_router.py`：workspace HTTP 测试风格与 PATCH 用例。
- `backend/app/modules/workspace/tests/test_schema_default_agent.py`：`WorkspaceUpdate` 的 set/clear/omit 测试写法。
- 调用点确认：`rg -n "list_runtimes|delete_runtime|disable_runtime|enable_runtime|/runtimes/\\{runtime_id\\}|/runtimes/usage" backend/app/modules/daemon -S`；`rg -n "list_workspaces|allowed_workspace_ids|WorkspaceUpdate|created_by|include_deleted" backend/app/modules/workspace backend/app/modules/auth backend/app/modules/admin -S`。

## TDD 步骤

1. 新建 daemon 测试文件，先写 helper：普通用户 JWT header、平台管理员 header、权限授予、runtime 行创建、绑定 workspace 行创建。
2. 写 daemon 红灯测试：`test_runtime_page_route_order_not_captured_by_runtime_id`，请求 `/api/daemon/runtimes/page?limit=1&offset=0`，断言 200 且响应是分页对象。
3. 写 daemon 红灯测试：`test_legacy_runtimes_endpoint_keeps_array_shape`，请求 `/api/daemon/runtimes`，断言 body 是 list。
4. 写 daemon 红灯测试：平台管理员 page 可见多 owner runtime 且带 owner DTO；普通账号带 `user_id` 仍只见自己 runtime。
5. 写 daemon 红灯测试：`q/type/status/limit/offset` 组合过滤，断言 `total` 与分页项。
6. 写 daemon 红灯测试：PATCH runtime `display_alias` set/clear；断言原字段不变。
7. 写 daemon 红灯测试：平台管理员跨 owner disable/enable/delete 成功，以及绑定未软删 workspace 时 delete 仍 409。
8. 新建 workspace 测试文件，先写 helper：用户、角色权限、workspace 行创建、workspace role 绑定。
9. 写 workspace 红灯测试：平台管理员列表可见多 owner workspace 且带 owner DTO；`user_id` 过滤仅管理员生效。
10. 写 workspace 红灯测试：普通账号传其它用户 `user_id` 仍只返回已授权 workspace；未授权 workspace 不出现。
11. 写 workspace 红灯测试：`q/type/status/limit/offset` 组合过滤，断言响应仍为 `{items,total}`。
12. 写 workspace 红灯测试：PATCH workspace `display_alias` set/clear；断言 `name`、`slug`、`root_path` 不变。
13. 运行目标测试并记录预期失败点：
    ```bash
    cd backend && uv run pytest \
      app/modules/daemon/tests/test_runtime_admin_management.py \
      app/modules/workspace/tests/test_workspace_admin_management.py
    ```
14. 确认失败只来自尚未实现的字段、DTO、端点或权限分支；若出现 fixture、import、权限夹具错误，先在本任务 allowed_paths 内修正测试。
15. task-03/04/05 完成后重跑同一命令，所有本任务测试必须转绿；task-09 负责后端模块级完整回归。

## 验收标准

| 编号 | 验收项 | 验证方式 | 通过标准 |
|---|---|---|---|
| AC-01 | daemon 新测试文件存在且只在 allowed_paths 内 | `git diff --name-only` | 只新增/修改 `backend/app/modules/daemon/tests/**` 与本 task 文件 |
| AC-02 | workspace 新测试文件存在且只在 allowed_paths 内 | `git diff --name-only` | 只新增/修改 `backend/app/modules/workspace/tests/**` 与本 task 文件 |
| AC-03 | 平台管理员 runtime 全局列表测试覆盖 | 读测试/跑 pytest | admin 可见 A/B runtime，item 带嵌套 owner |
| AC-04 | 平台管理员 workspace 全局列表测试覆盖 | 读测试/跑 pytest | admin 可见 A/B workspace，`user_id` 可过滤 owner |
| AC-05 | 普通账号 `user_id` 不越权测试覆盖 | 读测试/跑 pytest | runtime 只见自己；workspace 只见 `allowed_workspace_ids` 授权集合 |
| AC-06 | 筛选分页测试覆盖 | 读测试/跑 pytest | daemon/workspace 均覆盖 `q/type/status/limit/offset`，并断言 `total` |
| AC-07 | 别名 PATCH 测试覆盖 | 读测试/跑 pytest | runtime/workspace 均覆盖 set 与 clear，原始字段不被覆盖 |
| AC-08 | `/runtimes/page` 路由顺序测试覆盖 | 读测试/跑 pytest | 请求返回 200 分页对象；不会出现 UUID parse 422 |
| AC-09 | 旧 `/runtimes` 数组兼容测试覆盖 | 读测试/跑 pytest | 响应仍为 list，不含分页 wrapper |
| AC-10 | 平台管理员跨 owner runtime 管理测试覆盖 | 读测试/跑 pytest | admin 可 disable/enable/delete 非本人 runtime |
| AC-11 | runtime 删除绑定保护测试覆盖 | 读测试/跑 pytest | admin 删除被未软删 workspace 绑定 runtime 返回 409 |
| AC-12 | owner DTO 形态测试覆盖 | 读测试/跑 pytest | 断言 `owner.user_id/email/display_name` 或 `owner is None`，无扁平 owner 字段 |
| AC-13 | TDD 红灯可定位 | 首次运行目标 pytest | task-03/04/05 前失败原因指向缺失字段/端点/实现，不是测试夹具错误 |
| AC-14 | 后续实现可转绿 | task-03/04/05 后运行目标 pytest | 两个测试文件全部通过 |
