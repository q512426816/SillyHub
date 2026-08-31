---
id: task-03
title: 'backend 端点与读视图——POST /machines/{id}/sillyspec-update（归属校验+504）+ `_build_machine_read` 显式组装 + `MachineSillySpecUpdateRead` 嵌套类型 + DaemonMachineRead 字段（depends_on: task-01, task-02）'
title_zh: 'backend 端点与读视图——POST /machines/{id}/sillyspec-update（归属校验+504）+ `_build_machine_read` 显式组装 + `MachineSillySpecUpdateRead` 嵌套类型 + DaemonMachineRead 字段（depends_on: task-01, task-02）'
author: 'qinyi'
created_at: 2026-08-31 08:31:16
priority: P0
depends_on: [task-01, task-02]
blocks: [task-06, task-08]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/test_machine_sillyspec.py
  - backend/tests/modules/daemon/test_machines_router.py
goal: >
  新增 POST /api/daemon/machines/{instance_id}/sillyspec-update 端点（归属校验+504）与机器列表读视图 3 字段
  （_build_machine_read 显式组装 + MachineSillySpecUpdateRead 嵌套类型），把 task-01 的 WS 通道与 task-02 的
  存储暴露给前端（task-06 gen:types 的输入）。
implementation:
  - router.py 仿 trigger_machine_self_update（:985-1015）加 POST /machines/{instance_id}/sillyspec-update——RuntimeAdminUser + DaemonService._get_owned_instance 归属校验，get_daemon_ws_hub().send_sillyspec_update(instance_id)，发送失败 raise DaemonRuntimeOffline(504)，返回 {"sent": True}（不返回 latest——npm latest 由 daemon 自行探测，后端不代查）
  - schema.py 仿 MachinePendingUpdateRead（router.py:560，如该类在 router.py 内则遵循现状就近放）加 MachineSillySpecUpdateRead（state/trigger/from_version/to_version/error/since）+ DaemonMachineRead 加 sillyspec_version/sillyspec_latest_version: str|None、sillyspec_update: MachineSillySpecUpdateRead|None
  - router.py _build_machine_read（:634）显式构造 3 新字段（该函数逐字段构造不走 model_validate，漏改即静默丢字段——Design Grill F2）；sillyspec_update dict→MachineSillySpecUpdateRead.model_validate
  - test_machine_sillyspec.py 补端点/视图部分：归属 403/404、离线 504、成功 {"sent": true}、machines 列表响应含 3 字段（含嵌套类型化形态）；如 test_machines_router.py 有快照式断言需同步则一并更新
acceptance:
  - 端点三态（成功/越权/离线）测试通过；OpenAPI schema 含新端点与新字段（gen:types 可再生）
  - GET /api/daemon/machines 响应 items[] 含 sillyspec_version/sillyspec_latest_version/sillyspec_update
  - 既有 machines 路由测试零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_machine_sillyspec.py app/modules/daemon/tests/test_machines_router.py -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon && uv run mypy app/modules/daemon
constraints:
  - 不改 ws_hub/protocol（task-01 已就绪）；不动 register/heartbeat 落库（task-02 已就绪）
  - sillyspec_update 响应字段 snake_case 与 daemon 上报对齐；MachineSillySpecUpdateRead 放置位置遵循 MachinePendingUpdateRead 现状（就近原则）
expects_from:
  - task-01: send_sillyspec_update 通道（在线 True/离线 False）
  - task-02: sillyspec_version/sillyspec_latest_version/sillyspec_update 三列与落库语义
provides:
  - contract: MachineSillySpecView
    fields: [sillyspec_version, sillyspec_latest_version, sillyspec_update]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
