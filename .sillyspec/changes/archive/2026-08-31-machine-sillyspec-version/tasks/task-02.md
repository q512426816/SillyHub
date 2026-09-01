---
id: task-02
title: 'backend DB 与落库——model.py 3 新列 + alembic 迁移 + register/heartbeat DTO 字段 + RuntimeService register 直接落值/心跳非 None 覆盖 + update 无键清除（D-002@v1）'
title_zh: 'backend DB 与落库——model.py 3 新列 + alembic 迁移 + register/heartbeat DTO 字段 + RuntimeService register 直接落值/心跳非 None 覆盖 + update 无键清除（D-002@v1）'
author: 'qinyi'
created_at: 2026-08-31 08:31:16
priority: P0
depends_on: []
blocks: [task-03, task-08]
requirement_ids: [FR-05]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/migrations/versions/20260831150000_add_daemon_sillyspec_fields.py
  - backend/app/modules/daemon/tests/test_machine_sillyspec.py
goal: >
  daemon_instances 加 sillyspec_version / sillyspec_latest_version / sillyspec_update 三列（alembic 迁移），
  register/heartbeat DTO 与服务层落库实现 D-002@v1 双通道语义（register 无条件直写含 null；心跳非 None 覆盖；
  sillyspec_update 无键清除），为 task-03 读视图与 task-05 daemon 上报打数据地基。
implementation:
  - model.py DaemonInstance 仿 pending_update（:88-91）加 3 列：sillyspec_version/sillyspec_latest_version 为 str|None Field(String(50))，sillyspec_update 为 dict|None Field(JSON)；注释锚定 D-002@v1 语义
  - 新迁移 20260831150000_add_daemon_sillyspec_fields.py——down_revision 取执行时 alembic heads 唯一 head（写卡时最新为 20260831130000_add_queued_message_position，实跑以 alembic heads 为准，撞车 re-parent）；upgrade 三个 op.add_column（String(50) nullable ×2 + JSON nullable），downgrade 对应 drop；结构照 202608291500_add_daemon_pending_update.py
  - router.py 心跳内联 DTO（:230-282）加 sillyspec_version: str|None(default=None, max_length=50)、sillyspec_latest_version 同款、sillyspec_update: DaemonHeartbeatSillySpecUpdate|None(default=None)——新内联 BaseModel DaemonHeartbeatSillySpecUpdate{state/trigger/from_version/to_version/error 均 str|None，max_length=50（error 200），不收紧 Literal，注释锚定宁宽勿断}；handler 透传 RuntimeService.heartbeat_daemon
  - schema.py DaemonRegisterRequest 加 sillyspec_version/sillyspec_latest_version（str|None）；router.py register handler 透传 DaemonService.register_daemon
  - runtime/service.py register_daemon 无条件直写 3 字段（对齐 :240-242 instance.version 先例，含 null——D-002@v1）；heartbeat_daemon 对 version/latest 仅非 None 覆盖、sillyspec_update 为 None 时置 NULL（语义同 pending_update）、非 None 时 upsert dict（backend 首写盖 since）；service.py facade register_daemon 签名加对应参数透传（心跳端点有直调 RuntimeService 先例 router.py:451，facade 心跳可不加）
  - 新增 backend/app/modules/daemon/tests/test_machine_sillyspec.py 落库部分（仿 test_pending_update_upsert.py）：register 携带版本→直写；register 不带→null 覆盖旧值；心跳非 None 覆盖；心跳缺省（Pydantic null）→保留；sillyspec_update 有→落库盖 since，无→置 NULL；迁移 upgrade/downgrade 可逆
acceptance:
  - 3 列存在且迁移可逆，alembic heads 单 head
  - D-002@v1 三分支语义各有测试断言通过（register 含 null 直写 / 心跳缺省保留 / update 无键清除）
  - test_pending_update_upsert.py 等既有心跳测试零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_machine_sillyspec.py -q --no-cov
  - cd backend && uv run pytest app/modules/daemon/tests/test_pending_update_upsert.py app/modules/daemon/tests/test_register_heartbeat_daemon.py -q --no-cov
  - cd backend && uv run alembic heads
constraints:
  - 不做 REST 端点与 _build_machine_read（task-03）；不动 pending_update 既有语义
  - state 不收紧 Literal；error 截断（≤200 字符）在服务层或 DTO validator 一处实现
  - since 由 backend 落库时盖（daemon 不上报），语义同 pending_update
provides:
  - contract: SillySpecColumns
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
