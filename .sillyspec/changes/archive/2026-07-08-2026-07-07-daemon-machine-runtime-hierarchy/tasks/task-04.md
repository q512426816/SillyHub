---
id: task-04
title: 后端单测（GET/PATCH/POST /machines）+ 既有端点回归（覆盖 FR-1,2,3,8）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-1, FR-2, FR-3, FR-8]
decision_ids: [D-001, D-002, D-003, D-007]
allowed_paths:
  - backend/app/modules/daemon/tests/test_machines_router.py
provides: {}
expects_from: {}
---

## goal
新建 `test_machines_router.py` 覆盖 `/machines` 三个新端点全维度，并对既有 daemon 端点做回归冒烟，确保 FR-1/2/3 通过、FR-8 不破。

## implementation
- 复用 `backend/conftest.py` 的 `client`(httpx AsyncClient) + `db_session`(AsyncSession) + `auth_headers` fixture；复用 `test_runtime_admin_management.py` 的 helper 习惯（`_create_user`/`_token_for`/`_headers`/`_grant_platform_permission(RUNTIME_ADMIN)`/`_create_daemon_instance`/`_create_runtime`）。
- GET /machines 全维度：
  - 机器级分页（limit/offset，total≠page）；
  - 筛选 `q`（hostname/display_alias/子 runtime provider 大小写不敏感 ILIKE）、`status` 精确、`provider`（含该 provider 的机器，EXISTS 子查询）、`user_id`（admin 按 owner 精确）；
  - 排序：online 优先 → last_heartbeat_at DESC；
  - 权限：admin 看全部 owner；普通用户固定追加 `user_id==actor`（请求 user_id 被忽略，scope 不放大，区别于 403）；
  - 派生字段：`runtime_count`、`online_runtime_count` 正确；`runtimes[]` 嵌套且含 provider/version/allowed_roots；
  - 边界：0-runtime 机器返回 `runtimes=[]`、计数 0（D-003）。
- PATCH /machines/{id}：
  - 正常更新 display_alias（strip）、显式 null 清空、省略=不变；
  - 越权（普通用户改他人机器）→ 403；不存在 instance_id → 404；
  - 0-runtime 机器可改别名（D-001，区别于 runtime 级 PATCH 需先有 runtime）。
- POST /machines/{id}/self-update：
  - 路由正确（mock `ws_hub` 单例注入受控 hub，仿 `test_ws_rpc.py` 的 `from app.modules.daemon import ws_hub as ws_hub_module` + monkeypatch `send_self_update`）；
  - 离线 instance / 发送失败 → 504 DaemonRuntimeOffline。
- 既有端点回归冒烟：`GET /runtimes/page`、`GET /runtimes`（数组 shape）、`GET /instances`、`PATCH /runtimes/{id}`、`PUT /runtimes/{id}/allowed-roots`、`POST /runtimes/{id}/self-update` 行为不变（FR-8）。

## 验收标准
- `cd backend && pytest` 全过，无新增 warning/error。
- 覆盖 design §11 后端验收 4 条：GET 分页/筛选/排序/权限/派生/0-runtime；PATCH 正常/null/403/404/0-runtime；POST 路由/504；既有端点回归。
- 对齐全局验收 FR-1/2/3/8 + D-001(归属)/D-002(instance.status)/D-003(空机器)/D-007(机器级分页)。
- 既有端点断言行数 + 字段值，不绑死 SQL 方言（backend-test-sqlite-vs-pg）。

## verify
- `cd backend && pytest app/modules/daemon/tests/test_machines_router.py -v`
- `cd backend && pytest app/modules/daemon -v`（既有端点回归 + 新测联动）
- `cd backend && pytest app/modules/daemon/tests/test_runtime_admin_management.py app/modules/daemon/tests/test_register_heartbeat_daemon.py -v`（确认 entity-binding 链路未破）

## constraints
- 不修改被测实现（router/service/schema）来通过测试；测试失败指向缺失能力而非 fixture 笔误。
- ws_hub 测试用 monkeypatch 注入受控 hub，不连真实 WS（仿 test_ws_rpc.py）；self-update 仅断言路由 + 异常映射。
- db_session 与 router session 为不同对象，断言 daemon_instance 字段时需 `refresh` 从 DB 读最新值（沿用现有约定）。
- fixture 复用既有 DB/session/helper 模式，不新建 conftest；helper 可在本文件内私有复刻（与 test_runtime_admin_management.py 同风格）。
- 测试逻辑本身无误才可改测试；中文 docstring 标注覆盖的 FR/D/AC。
