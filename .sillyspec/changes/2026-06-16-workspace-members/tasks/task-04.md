---
id: task-04
title: backend 装载 members_router（prefix `/api/workspaces/{workspace_id}/members`）；启动 backend 健康检查通过
priority: P0
estimated_hours: 0.5
depends_on: [task-03]
blocks: [task-05, task-10]
allowed_paths:
  - backend/app/modules/workspace/router.py
  - backend/app/main.py
---

# Task-04 — backend 装载 members_router

## 1. 目标

把 task-03 产出的 `members_router`（6 个端点）挂载到 FastAPI app 上，对外暴露前缀 `/api/workspaces/{workspace_id}/members`，并保证 backend 启动 + 健康检查 + OpenAPI 文档正常。

依据文档：

- `design.md` §5.1：`app.include_router(members_router, prefix="/api/workspaces/{workspace_id}/members", tags=["workspace-members"])`
- `design.md` §6 文件清单：修改 `workspace/router.py` 或 `app/main.py` include members_router
- `plan.md` Wave 2 task-04：include members_router + 启动健康检查通过

## 2. 修改文件

**首选**：`backend/app/modules/workspace/router.py` 末尾追加一行 include（保持 workspace 子路由器内聚，无需改 main.py 的 include 顺序）：

```python
# 文件末尾追加
from app.modules.workspace.members_router import router as members_router  # noqa: E402

router.include_router(
    members_router,
    prefix="/{workspace_id}/members",
    tags=["workspace-members"],
)
```

> 复用 workspace_router 自身的 `prefix="/workspaces"`，外层 `app.include_router(workspace_router, prefix="/api")` 已在 `main.py:230` 注册，最终展开为 `/api/workspaces/{workspace_id}/members/*`，与 design §5.1 一致。

**次选**（仅当首选路径与现有路由冲突或 hook 报错时启用）：在 `backend/app/main.py:230`（`workspace_router` 行之后）追加：

```python
from app.modules.workspace.members_router import router as members_router
app.include_router(
    members_router,
    prefix="/api/workspaces/{workspace_id}/members",
    tags=["workspace-members"],
)
```

## 3. 实现要求

1. **导入**：从 `app.modules.workspace.members_router` 引入 `router`（task-03 产物）。导入放在文件顶部 imports 区或末尾（避免循环导入；如出现循环，则改为函数内 lazy import）。
2. **include_router 调用**：必须显式传 `prefix` 与 `tags`，**不要**依赖 members_router 自身的 prefix（members_router 定义为 `APIRouter()` 无 prefix，prefix 完全由本任务注入）。
3. **prefix 不与现有冲突**：现有 `router.py` 已有 `/{workspace_id}` 子路径（`activate` / `relations` / `rescan` / `generate-projects` / `reparse` / DELETE / PATCH），**新增 `/{workspace_id}/members` 不能覆盖任何现有路径**。验证：`/members` 与 `/relations` / `/activate` 等是平级不同 token，无前缀重叠。
4. **tags 唯一性**：`workspace-members` 是新 tag，与现有 `workspace` tag 区分；Swagger UI 会分组展示。
5. **`workspace_id` 路径参数复用**：members_router 内的端点必须以 `workspace_id: uuid.UUID` 作为首个路径参数；本任务无需在 include 处再声明，FastAPI 自动从 prefix 中解析。

## 4. 接口定义

最终生效代码（首选路径）：

```python
# backend/app/modules/workspace/router.py 末尾
from app.modules.workspace.members_router import router as members_router

router.include_router(
    members_router,
    prefix="/{workspace_id}/members",
    tags=["workspace-members"],
)
```

展开后 6 个端点（与 design §5.1 表格一致）：

| 方法 | 完整路径 |
|------|----------|
| GET | `/api/workspaces/{workspace_id}/members` |
| GET | `/api/workspaces/{workspace_id}/members/search` |
| POST | `/api/workspaces/{workspace_id}/members` |
| PATCH | `/api/workspaces/{workspace_id}/members/{user_id}` |
| DELETE | `/api/workspaces/{workspace_id}/members/{user_id}` |
| POST | `/api/workspaces/{workspace_id}/members/{user_id}/transfer-ownership` |

## 5. 边界处理

1. **prefix 不重复**：执行前 `grep -n "include_router(members_router" backend/app` 必须为空；执行后只命中本次新增的一处，禁止重复 include 导致端点路径翻倍。
2. **tags 不冲突**：`workspace-members` 在全代码库 `grep "tags=\[" backend/app` 中唯一；与 `workspace` / `auth` / `task` / `change` 等已有 tag 无交集。
3. **workspace_id 路径参数必须复用**：members_router 端点的 `workspace_id` 参数类型 `uuid.UUID`，与 `router.py` 现有 `/{workspace_id}` 路径参数完全一致（同类型同名），保证 FastAPI 路由匹配不出现"参数名同但类型不同"的冲突。
4. **导入循环风险**：`members_router` 若 import 了 `workspace.service` 而 `workspace/router.py` 反向 import `members_router`，会触发 ImportError。缓解：本任务导入放在 `router.py` 文件**末尾**（而非顶部），让 members_router 的导入发生在所有顶层符号定义之后。
5. **OpenAPI 路径展开顺序**：FastAPI 对 `/{workspace_id}/members/search` 与 `/{workspace_id}/members/{user_id}` 的注册顺序敏感；members_router 内部必须把 `/search` 定义在 `/{user_id}` 之前（task-03 已保证），否则 `/search` 会被 `/{user_id}` 抢匹配。

## 6. 非目标

- **不动**现有 `/api/workspaces` / `/api/workspaces/{id}` / `/api/workspaces/{id}/relations` 等路由的注册顺序与行为
- **不动** `main.py` 中 workspace_router 的 include 位置（line 230，在 quick-chat 之后）；如选次选路径，新 include 紧随其后，不改其他 router 顺序
- **不修改** members_router 的端点逻辑（属于 task-03 范围）
- **不写**测试用例（属于 task-05 范围；本任务只做装载 + 启动验证）
- **不调整** Permission / RBAC seed（design §8 明确无 schema 变更）

## 7. 参考

其他子 router 的 include 模式（已在代码中验证）：

- `main.py:230` `app.include_router(workspace_router, prefix="/api")`：workspace_router 自身 `prefix="/workspaces"`，外层拼成 `/api/workspaces/*`
- `main.py:231` `app.include_router(auth_router, prefix="/api")`：同模式
- `main.py:223` `_register_quick_chat` 内部 `app.include_router(qc_router, prefix="/api")`：内嵌 router 无 prefix，外层注入

本任务采用"router.include_router 子 router"模式（与 `change` 模块 `change_router` 内部聚合多个 sub-router 同构），保持 workspace 模块内聚。

## 8. TDD 步骤

本任务**不写 pytest**（测试由 task-05 全量覆盖装载 + 端点行为）。本任务的最小验证：

1. **静态导入检查**：
   ```bash
   cd backend && uv run python -c "from app.modules.workspace.router import router; print(len(router.routes))"
   ```
   期望：无 ImportError，路由数量比 task-04 之前增加 6。

2. **启动 uvicorn**：
   ```bash
   cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 &
   ```
   期望：日志 `Uvicorn running on http://127.0.0.1:8000`，无 traceback。

3. **健康检查**：
   ```bash
   curl -sS http://127.0.0.1:8000/api/health
   ```
   期望：HTTP 200，响应含 `{"status": "ok"}` 或等价字段（参考 `health/router.py`）。

4. **OpenAPI 校验**：
   ```bash
   curl -sS http://127.0.0.1:8000/api/openapi.json | python -c "import json,sys; d=json.load(sys.stdin); paths=[p for p in d['paths'] if '/members' in p]; print(len(paths), paths)"
   ```
   期望：输出 6 个路径，全部以 `/api/workspaces/{workspace_id}/members` 开头。

5. **关闭 uvicorn**：`kill %1` 或 Ctrl+C。

## 9. 验收标准

| 编号 | 检查项 | 通过条件 |
|------|--------|----------|
| AC-1 | uvicorn 启动无错 | `uv run uvicorn app.main:app --port 8000` 启动后无 Exception / Traceback；进程存活 |
| AC-2 | /api/health 返回 200 | `curl /api/health` HTTP 200，body 含 status 字段 |
| AC-3 | OpenAPI 含 6 个新端点 | `/api/openapi.json` 中以 `/api/workspaces/{workspace_id}/members` 为前缀的路径数量 = 6（list / search / add / patch / delete / transfer-ownership） |
| AC-4 | 现有路由不回归 | `/api/openapi.json` 中 `/api/workspaces` 开头的非 members 路径数量与 task-04 前一致（至少包含 `/api/workspaces` GET/POST、`/api/workspaces/{workspace_id}` GET/PATCH/DELETE、`/api/workspaces/{workspace_id}/relations` GET/POST 等） |
| AC-5 | Swagger UI 分组正确 | 访问 `/api/docs`，新增 `workspace-members` tag 分组，6 个端点全部归类到该 tag 下 |
| AC-6 | 无重复 include | `grep -rn "include_router(members_router" backend/app` 输出恰好 1 行 |

## 10. 风险与回滚

- **风险**：members_router 内部端点顺序错误导致 `/search` 被 `/{user_id}` 抢匹配 → 由 task-03 保证；本任务发现时退回 task-03 修复，不在本任务改 members_router。
- **回滚**：删除 `router.py` 末尾的 `router.include_router(...)` 三行 + 顶部 import 即可恢复原状；无数据库迁移、无配置变更。
