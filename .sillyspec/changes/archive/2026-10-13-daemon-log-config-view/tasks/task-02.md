---
id: task-02
title: 'backend 转发端点（测试同卡 + 类型产物收尾）——DTO/两端点/_ENDPOINT_ORDER + pytest + openapi.json + gen:types'
title_zh: 'backend 转发端点（测试同卡 + 类型产物收尾）——DTO/两端点/_ENDPOINT_ORDER + pytest + openapi.json + gen:types'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 17:07:07
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/router/__init__.py
  - backend/tests/modules/daemon/test_daemon_machine_diag.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/router/__init__.py
  - NEW:backend/tests/modules/daemon/test_daemon_machine_diag.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
goal: >
  新增 machine 级两个只读转发端点（GET /api/daemon/machines/{instance_id}/logs?tail= 与 /config?reveal=），
  经 ws_hub.send_rpc 转发到 daemon 新 RPC；错误映射锁定（离线/超时原样透传 504、method_not_found→422、其余→502）。
  测试同卡；收尾产出类型产物（openapi.json + api-types.ts）供 task-03 消费。
implementation:
  - 先写 backend/tests/test_daemon_machine_diag.py（红）：转发成功（mock hub.send_rpc 返回 result）/ 离线 504 / 超时 504 / method_not_found→422 / 其余远端错→502 / 参数 tail 与 reveal 透传 / 鉴权归属校验（参照 backend/tests 既有 daemon 测试的 mock 模式）
  - backend/app/modules/daemon/schema.py 新增 DaemonLogTailResponse（path/size/mtime/exists/lines/line_count/truncated）与 DaemonConfigResponse（path/config/masked_fields）——字段与 design.md 接口定义节逐字一致
  - backend/app/modules/daemon/router/machines.py 新增两个 GET 端点（风格对齐 trigger_machine_cleanup）：RuntimeAdminUser 鉴权 + svc._get_owned_instance 归属校验 + hub.send_rpc(instance_id, method, params, timeout=30)；错误映射复制 backend/app/modules/platform_sync/router.py:764-831 语义（离线/超时原样透传不包裹；method_not_found→422 HTTP_422_DAEMON_DIAG_UNSUPPORTED；其余→DaemonRpcRemoteGatewayError 502）
  - backend/app/modules/daemon/router/__init__.py 的 _ENDPOINT_ORDER 追加两个端点条目（漏同步启动即 RuntimeError）
  - 运行形状：pytest 全绿 → 重新生成 backend/openapi.json → cd frontend && pnpm gen:types 更新 frontend/src/lib/api-types.ts（两个产物纳入本卡提交）
acceptance:
  - test_daemon_machine_diag.py 全绿（成功+四类错误映射+参数透传）
  - backend 相关测试集全绿（daemon 模块既有测试不回归）
  - openapi.json 含两个新端点与两个新 schema；api-types.ts 含 DaemonLogTailResponse/DaemonConfigResponse 类型（gen:types 产出，不手写）
verify:
  - cd backend && uv run pytest tests/test_daemon_machine_diag.py -q --no-cov
  - cd frontend && pnpm gen:types && git diff --stat -- src/lib/api-types.ts
constraints:
  - 不改任何既有端点行为；不改 backend/app/main.py（router 已挂载 /api）
  - 错误映射不包裹不改写既有 AppError code（离线/超时原样透传，测试断言锁定）
  - DTO 字段名与 daemon result 键逐字一致（snake_case，前端 apiFetch 原样消费）
---
