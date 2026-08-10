---
id: task-06
title: platform_sync router three endpoints and main mount
title_zh: platform_sync router 三端点(POST progress/GET 列表/GET 单change)与 main 挂载
author: qinyi
created_at: 2026-08-10 23:45:00
priority: P0
depends_on: [task-03, task-04, task-05]
blocks: [task-07, task-09]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-005@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - backend/app/main.py
goal: >
  实现 3 端点：POST /api/changes/{name}/progress（读 3 个 X-SillySpec-* header +
  冲突检测 → 200/409）、GET /api/changes（轻量列表）、GET /api/changes/{name}/progress
  （完整 JSON，不存在 404），并在 main.py 挂载 prefix=/api。
implementation:
  - 新建 backend/app/modules/platform_sync/router.py：router = APIRouter(tags=["platform-sync"])（**不自带 prefix**，路径在路由内写全，避免 GET /changes 尾斜杠 redirect 问题——客户端打 /api/changes 无尾斜杠）
  - POST /changes/{name}/progress：参数 _user=Depends(require_platform_sync), request: Request, name: str, body: dict[str, Any]；读 3 header：request.headers.get('X-SillySpec-User'), .get('X-SillySpec-Base-Ts'), .get('X-SillySpec-Pushed-At')（缺失/空均 None）；result = await PlatformSyncService(session).upsert_progress(name, body, base_ts, pushed_at, user)；if result.conflict：raise HTTPException(409) 或 return ConflictResponse（用 fastapi.status.HTTP_409_CONFLICT + JSONResponse，确保 409 状态码 + 契约 §4.4 body）；else return ProgressSyncOk()
  - GET /changes：_user=Depends(require_platform_sync)；items = await PlatformSyncService(session).list_lightweight()；return [ChangeListItem(**it) for it in items]（裸数组形态，D-007）
  - GET /changes/{name}/progress：_user=Depends(...)；progress = await PlatformSyncService(session).get_progress(name)；if progress is None：raise HTTPException(404)；return progress（裸六表 + 顶层 last_pushed_at，D-007）
  - main.py：import platform_sync router；app.include_router(platform_sync_router, prefix="/api", tags=["platform-sync"])（挂在 change_router 之后或之前均可，路由不冲突 Grill X-003）
acceptance:
  - POST /api/changes/{name}/progress 读 3 个 X-SillySpec-* header，200 或 409（409 body 含 conflict/platform_progress/last_pushed_at）
  - GET /api/changes 返回裸数组 [{name,current_stage,last_pushed_at,last_pusher}]
  - GET /api/changes/{name}/progress 返回裸六表 + 顶层 last_pushed_at；不存在 404
  - 3 端点均要求 Authorization Bearer（require_platform_sync），无 token 401
  - 与现有 /api/workspaces/{wid}/changes/* 路由不冲突
verify:
  - cd backend && uv run ruff format --check app/modules/platform_sync app/main.py && uv run ruff check app/modules/platform_sync app/main.py
  - cd backend && uv run mypy app/modules/platform_sync/router.py
  - 端点行为由 task-07 完整测试覆盖
constraints:
  - router 不自带 prefix（路径写全 /changes/...），避免 GET /changes 尾斜杠 redirect（客户端打无尾斜杠 /api/changes）
  - 3 个 X-SillySpec-* header 缺失/空均视为 None（契约 §4.1 / D-005 零回归）
  - 409 必须返回正确状态码 + 契约 §4.4 body（客户端 fetchJsonWithStatus 读 res.status==409 + res.body.platform_progress，sync.js:314-318）
  - body 用 dict[str, Any] 接收（NG-6 裸透传），不定义强类型 Pydantic 模型校验六表
  - 不碰现有 change/router.py（契约 D-004）
---
