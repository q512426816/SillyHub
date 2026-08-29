---
id: task-01
title: 'backend-control-commands-table-service-migration'
title_zh: 'backend 控制指令表+服务+迁移（daemon_control_commands 表 + ControlCommandService + alembic）'
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-004@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/control_commands.py
  - backend/migrations/versions/20260829_1200_add_daemon_control_commands.py
  - backend/app/modules/daemon/tests/test_control_commands.py
provides:
  - contract: ControlCommandService
    fields: [enqueue, mark_delivered, fetch_pending, ack, gc]
goal: >
  新增 daemon_control_commands 控制指令表与 ControlCommandService 服务及 alembic 建表迁移，为控制指令落库待发与断线补拉提供数据层基础。
implementation:
  - 在 backend/app/modules/daemon/model.py 新增 DaemonControlCommand 表（id UUID 主键即 command_id、runtime_id FK 指向 daemon_runtimes、kind String(32)、payload JSON、status 词表 pending/delivered/acked/expired、created_at/delivered_at/ack_at/expires_at 时间戳列，参考 DaemonChangeWrite 先例）
  - 新增 backend/app/modules/daemon/control_commands.py 实现 ControlCommandService 的 enqueue/mark_delivered/fetch_pending/ack/gc 五方法，fetch_pending 仅返回 status=pending 行且 created_at 升序，delivered 一律不重发（D-006 零重复执行优先）
  - expires_at 入队时按 kind 计算，session_inject 为 10min、permission_response 为 6min、其余 kind 为 30min
  - 新增 alembic 迁移 backend/migrations/versions/20260829_1200_add_daemon_control_commands.py，实现建表 upgrade 与 drop downgrade
  - 新增 backend/app/modules/daemon/tests/test_control_commands.py 覆盖 enqueue 落库、fetch_pending 过滤、状态推进、gc 过期清理与按 kind 的 expires_at
acceptance:
  - enqueue 后行落库且 status=pending，expires_at 按 kind 正确写入（inject 10min、permission_response 6min、其余 30min）
  - fetch_pending 仅返回 pending 行不返回 delivered/acked/expired；mark_delivered 与 ack 正确推进状态机（pending 到 delivered、pending 或 delivered 到 acked）
  - gc 将 pending 超过 expires_at 的行标 expired，acked 保留 1h 后删除
  - alembic 迁移 upgrade 与 downgrade 幂等可重跑，alembic heads 输出单 head
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_control_commands.py -q
  - cd backend && uv run alembic heads（确认输出单 head）
constraints:
  - 不改任何下发方调用（session/permission/provider_switch 接线属 task-04），本 task 仅提供表与服务
  - 不实现控制指令 GC 常驻挂载与 inject 过期联动 run failed（属 task-04）
  - 遵循 .sillyspec/docs/SillyHub/scan/CONVENTIONS.md 代码风格；不跑全量测试，仅跑本 task 新增测试
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
