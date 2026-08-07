---
id: task-06
title: router.py POST ready 端点
title_zh: 后端接收 session ready 上报端点
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P0
depends_on: [task-05]
blocks: [task-04, task-07]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
expects_from:
  task-05:
    - contract: SessionReadiness
      needs:
        - mark_ready
goal: >
  新增 daemon 上报 ready 的 HTTP 接收端点，daemon create 完成（fresh 加 recover）
  POST ready，backend 鉴权后调 SessionReadiness.mark_ready 唤醒 inject_session 等待
  协程（task-08），解 /model 等 inject 偶发空白（design Phase 1 与 2）。
implementation:
  - 参照 recover_session（router.py 1246）与 delete_runtime（router.py 883）范式新增 POST sessions session_id ready 路由，路径参数 session_id 为 UUID，不声明 body 模型（daemon 上报 body 空）
  - 复用 daemon 鉴权 get_current_principal（X-API-Key，同 recover 与 confirm-reconnected 端点）
  - handler 内调 SessionReadiness.mark_ready，优先 DaemonService 薄包装 mark_session_ready，否则直接取 task-05 模块级单例
  - 返回 200 加 JSON body（如 return 一个含 ok True 的 dict），对齐 daemon hub-client _request 的 JSON.parse 契约（204 空 body 会使 JSON.parse 抛 SyntaxError，故用 200 JSON 非 204）
acceptance:
  - POST session ready 端点存在并被 FastAPI 注册
  - 走 daemon 鉴权（get_current_principal 与 X-API-Key，无 key 返 401）
  - handler 内调 SessionReadiness.mark_ready（经 DaemonService 或单例）
  - 通过 auth 且 body 空时返回 200 加 JSON body ok=True
  - 端点单测过（task-12 覆盖鉴权 mark_ready mock 与 204）
verify:
  - cd backend && ruff check app/modules/daemon/router.py
  - cd backend && python -m pytest
constraints:
  - 复用既有 daemon auth（get_current_principal）不另造鉴权
  - body 空不引入 pydantic 请求体模型（design Phase 2 接口定义）
  - session_id 必须 UUID 路径参数（非法 FastAPI 422），鉴权失败由 get_current_principal 统一 401 或 403 不另抛
  - 依赖 task-05 单例就绪，mark_ready 调用前确认 SessionReadiness 已实例化（gap-2）
---
