---
id: task-10
title: daemon/router.py GET /api/daemon/runtimes/usage 端点挂载
priority: P1
estimated_hours: 2
depends_on: [task-08, task-09]
blocks: [task-11, task-15]
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/router.py
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-10: daemon/router.py GET /api/daemon/runtimes/usage 端点挂载

## 修改文件（必填）

- `backend/app/modules/daemon/router.py` — 新增 `GET /runtimes/usage` 端点(router 已有 `prefix="/daemon"`,实际路径 `/api/daemon/runtimes/usage`),挂载位置放在现有 runtime 端点区块附近(参考 `router.py:178 @router.get("/runtimes/{runtime_id}")` 同一区块)。import 新增 `RuntimeService`(或经 `DaemonService` facade delegate)与 `RuntimeUsage*` schema。不改动现有端点。

## 覆盖来源

- Requirements: FR-03(批量返回全部 runtime 用量)
- Decisions: 无本任务专属决策(时区/分组/去重在 task-08 service 层;window 参数由 task-09 Enum 拦截)

## 实现要求

1. **路径**:`GET /runtimes/usage`(router 已 `prefix="/daemon"`,最终 `/api/daemon/runtimes/usage`)。注意 `/usage` 是字面子路径,不会被 `/runtimes/{runtime_id}` 路由匹配(FastAPI 静态路由优先于动态路径,但为保险放在 `/runtimes/{runtime_id}` **之前**声明,避免被 `{runtime_id}` 捕获 `usage` 字符串 — 实际 FastAPI 按声明顺序匹配,静态优先)。
2. **Query 参数**:`window: RuntimeUsageWindow = Query(RuntimeUsageWindow.DAY7)`,默认 7d(用户最常用窗口)。FastAPI 自动 parse `"1d"|"7d"|"30d"` query string 为 Enum,非法值返回 422。
3. **权限**:用 `RuntimeAdminUser`(`router.py:110` 已定义的 `require_permission_any(Permission.RUNTIME_ADMIN)`),与 `get_runtime`/`disable_runtime` 等管理 UI 端点一致 — usage 面板属管理 UI,需 admin 权限。
4. **Service 调用**:通过 `DaemonService(session)` facade delegate(参考 `router.py:146-156 register_daemon` 用 `DaemonService(session)`;`DaemonService.__init__` 内已 lazy import `RuntimeService` 并存为 `self._rt`,`service.py:77-80`)。在 `DaemonService` 加薄 delegate 方法 `get_runtimes_usage(window) -> list[RuntimeUsageRead]` 转发 `self._rt.get_runtimes_usage(window)`,或直接在 router 内 `from app.modules.daemon.runtime.service import RuntimeService; svc = RuntimeService(session)`。**推荐走 DaemonService facade** 保持 router 与 service 子包解耦的一致性(参考现有 `get_runtime`/`list_runtimes` 都经 DaemonService)。若走 facade,需在 `backend/app/modules/daemon/service.py` 加一行 delegate(本任务 allowed_paths 仅 router.py — delegate 方法放 service.py 需扩展 allowed_paths;**为保持 allowed_paths 单一,本任务直接在 router 内 `RuntimeService(session)`** 并在 router 顶部 lazy import,与 `router.py:1268` 已有 `from sqlalchemy import text as sa_text` 函数内 import 模式一致)。
5. **响应封装**:`response_model=RuntimeUsageListResponse`,返回 `RuntimeUsageListResponse(window=window.value, runtimes=usage_list)`。`window.value` 取 Enum 的字符串值(`"7d"`),与 design §7 响应 `"window": "7d"` 一致。
6. **错误处理**:service 层不抛业务异常(空窗返回 `[]`);window Enum 边界 422 由 FastAPI 自动处理。router 内 try/except 包裹可选(参考现有端点多数不包 try,异常由全局 handler 处理),本端点遵循同样风格不包 try。
7. **日志**:`log.info("runtimes_usage_served", window=window.value, count=len(usage_list))`(可选)。
8. **不破坏现有端点**:新增端点独立,不影响 `/runtimes`、`/runtimes/{runtime_id}`、`/sessions` 等(FR-05 兼容)。
9. **CONVENTIONS 提醒**:backend 改动**必须实测 API**(curl),验收步骤含 curl 实测。

## 接口定义（代码类必填）

```python
# backend/app/modules/daemon/router.py

# 顶部 import 区追加(router.py:40-63 现有 from app.modules.daemon.schema import (...)):
from app.modules.daemon.schema import (
    # ... 现有 import 不动 ...
    RuntimeUsageListResponse,       # 新增
    RuntimeUsageWindow,             # 新增
)

# Query 已在 router.py:12 import(Query)
# RuntimeService 在端点函数内 lazy import(避免顶部循环 import,与现有模式一致)


# ── Runtime usage stats (FR-03) ────────────────────────────────────────────
@router.get(
    "/runtimes/usage",
    response_model=RuntimeUsageListResponse,
)
async def get_runtimes_usage(
    window: RuntimeUsageWindow = Query(
        RuntimeUsageWindow.DAY7,
        description="时间窗:1d(当日本地自然日,按小时)/ 7d / 30d(按日)",
    ),
    session: SessionDep,
    user: RuntimeAdminUser,
) -> RuntimeUsageListResponse:
    """批量返回全部 runtime 在指定时间窗内的 token/cache/cost 用量。

    聚合在 service 层用单条 LEFT JOIN+COALESCE SQL 去重(D-003@v2,task-08);
    分组粒度 1d→hour / 7d·30d→day(D-002@v1);起点 1d=本地自然日 today 00:00(D-004@v1)。
    """
    from app.modules.daemon.runtime.service import RuntimeService

    svc = RuntimeService(session)
    runtimes = await svc.get_runtimes_usage(window.value)
    log.info("runtimes_usage_served", window=window.value, count=len(runtimes))
    return RuntimeUsageListResponse(window=window.value, runtimes=runtimes)
```

```python
# 备注:DaemonService facade delegate(可选,若 reviewer 要求保持 facade 一致性
# 则扩展 allowed_paths 含 service.py 并加此方法,转发到 self._rt):
# backend/app/modules/daemon/service.py(在 DaemonService 类内,现有 list_runtimes 旁):
#     async def get_runtimes_usage(self, window: RuntimeUsageWindowLiteral) -> list[RuntimeUsageRead]:
#         return await self._rt.get_runtimes_usage(window)
# 本任务默认直接在 router 用 RuntimeService,allowed_paths 仅 router.py。
```

## 边界处理（必填,至少5条）

1. **window 非法值(422)**:`window: RuntimeUsageWindow = Query(...)` Enum 类型,FastAPI 对非法 query string(如 `?window=2d`、`?window=`)自动返回 422 Unprocessable Entity,不进 service 层。`?window` 缺省时用默认值 `DAY7`(7d)。
2. **路由顺序 / 路径冲突**:`/runtimes/usage` 是静态路径,与 `/runtimes/{runtime_id}` 动态路径共存。**必须把 `/runtimes/usage` 声明在 `/runtimes/{runtime_id}` 之前**(FastAPI 按声明顺序匹配),否则 `usage` 会被 `{runtime_id}` 捕获再 UUID parse 失败(422)。本任务实现时确认放置位置,或验证 FastAPI 静态优先行为。
3. **空窗 / 无 runtime**:`runtimes=[]` 正常返回 200 `{"window": "7d", "runtimes": []}`,前端 task-14 处理空数组(显示空卡片/占位)。
4. **权限不足(403)**:`RuntimeAdminUser` 依赖对无 `RUNTIME_ADMIN` 权限的用户抛 403,与 `get_runtime`/`disable_runtime` 行为一致。
5. **认证缺失(401)**:`require_permission_any` 内部依赖 `get_current_principal`,未认证请求 401,遵循全局认证流程。
6. **window.value 字符串化**:`RuntimeUsageListResponse(window=window.value, ...)` 显式取 `.value`(`"7d"`),不用 Enum 实例(避免 JSON 序列化为 `"RuntimeUsageWindow.DAY7"`)。Pydantic v2 虽能 serialize str-Enum 为值,但显式 `.value` 更清晰且与 design §7 示例一致。
7. **service 层异常透传**:service 不抛业务异常(空窗返回 `[]`),但 DB 连接异常等会冒泡到全局 handler 返回 500。本端点不包 try/except,遵循现有 `get_runtime`/`list_runtimes` 等端点的"异常透传"风格。
8. **lazy import 防循环**:`from app.modules.daemon.runtime.service import RuntimeService` 在函数内 lazy import(参考 `router.py:1268` 函数内 `from sqlalchemy import text as sa_text` 模式),避免顶部 import 循环(service.py 可能已 import router 间接依赖)。

## 非目标

- 不实现聚合 SQL / 去重逻辑(task-08)。
- 不定义 Pydantic schema(task-09)。
- 不做权限模型调整(沿用现有 `RUNTIME_ADMIN`)。
- 不加缓存 / SSE 实时推送(D-004@v1 非实时)。
- 不改 `/runtimes` 列表端点返回结构(FR-05 兼容,新增独立端点)。
- 不加 DaemonService facade delegate(除非 reviewer 要求;默认直接 router→RuntimeService,allowed_paths 仅 router.py)。

## 参考

- `router.py:106` `router = APIRouter(prefix="/daemon", tags=["daemon"])` — prefix 已定,本端点 `/runtimes/usage` 拼成 `/api/daemon/runtimes/usage`。
- `router.py:110` `RuntimeAdminUser` 定义。
- `router.py:114-156` `get_daemon_version`/`register_daemon` — 管理端点 + DaemonService 调用范例。
- `router.py:178-195` `get_runtime`(`@router.get("/runtimes/{runtime_id}")`)— 同区块 runtime 端点范例,**注意路由顺序**(静态 `/usage` 要在动态 `/{runtime_id}` 前)。
- `router.py:1268-1281` 函数内 `from sqlalchemy import text as sa_text` lazy import + `sa_text` SQL 执行模式。
- `service.py:77-80` `DaemonService.__init__` 内 `self._rt = RuntimeService(session)` — facade delegate 基础(若选 facade 方案)。
- design.md §7 REST 接口定义(响应结构来源)。

## TDD 步骤

1. **先写测试** `backend/tests/modules/daemon/test_runtimes_usage_endpoint.py`(用 FastAPI TestClient / httpx AsyncClient):
   - `test_get_runtimes_usage_default_window`:GET `/api/daemon/runtimes/usage`(无 query)→ 200,`response.json()["window"] == "7d"`,`runtimes` 为 list。
   - `test_get_runtimes_usage_window_1d`:GET `?window=1d` → 200,`window == "1d"`。
   - `test_get_runtimes_usage_window_30d`:GET `?window=30d` → 200,`window == "30d"`。
   - `test_get_runtimes_usage_invalid_window_422`:GET `?window=2d` → 422。
   - `test_get_runtimes_usage_structure`:带 fixture 数据(1 个 run),断言 `runtimes[0]` 有 `runtime_id`(str)、`summary`(5 字段)、`daily`(list,每项有 ts + 5 字段)。
   - `test_get_runtimes_usage_empty_returns_empty_list`:无数据 → 200 `{"window": ..., "runtimes": []}`。
   - `test_get_runtimes_usage_requires_admin`:无权限用户 → 403;未认证 → 401。
   - `test_route_not_shadowed_by_runtime_id`:GET `/api/daemon/runtimes/usage` 不被 `/runtimes/{runtime_id}` 路由捕获(返回 200 非 422 UUID parse 失败)。
2. **跑测试确认全红**(端点未实现 → 404)。
3. **实现** 端点 + import。
4. **跑测试确认全绿**。
5. **mypy / ruff** 通过。
6. **curl 实测**(CONVENTIONS:backend 改动必须实测 API):
   - 启动 backend(`local.yaml` 子项目命令)。
   - `curl -s -H "Authorization: Bearer <admin_token>" "http://localhost:<port>/api/daemon/runtimes/usage?window=7d" | jq .` 验证结构。
   - `curl -s ... "?window=2d"` 验证 422。
   - 截图/粘贴响应到 task 完成 evidence。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | 运行 `test_get_runtimes_usage_default_window` 单测 | GET `/api/daemon/runtimes/usage` 默认 `window="7d"`,200,`runtimes` 为 list |
| 2 | 运行 `test_get_runtimes_usage_window_1d` / `_30d` 单测 | `?window=1d`/`30d` 正确透传到 service,响应 `window` 字段正确 |
| 3 | 运行 `test_get_runtimes_usage_invalid_window_422` 单测 | `?window=2d` 返回 422(Enum 边界拦截) |
| 4 | 运行 `test_get_runtimes_usage_structure` 单测 | 响应结构符合 design §7(runtime_id:str + summary 5 字段 + daily list[ts+5字段]) |
| 5 | 运行 `test_get_runtimes_usage_empty_returns_empty_list` 单测 | 空数据返回 200 `{"window":..., "runtimes":[]}` 不抛异常 |
| 6 | 运行 `test_get_runtimes_usage_requires_admin` 单测 | 非 admin 403,未认证 401 |
| 7 | 运行 `test_route_not_shadowed_by_runtime_id` 单测 | `/runtimes/usage` 不被 `/runtimes/{runtime_id}` 捕获(返回 200 非 422) |
| 8 | `mypy backend/app/modules/daemon/router.py` | 无类型错误 |
| 9 | `ruff check backend/app/modules/daemon/router.py` | 无 lint 错误 |
| 10 | **curl 实测**(CONVENTIONS 必做) | 启动 backend 后 `curl .../api/daemon/runtimes/usage?window=7d` 返回正确 JSON 结构,`?window=2d` 返回 422,evidence 贴响应 |
| 11 | 现有 `/runtimes`、`/sessions` 等端点单测全绿 | 未破坏既有端点(FR-05 兼容) |
