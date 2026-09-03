---
id: task-01
title: 'backend 数据层——Machine.sillyspec_status JSON 列 + add_machine_sillyspec_status 迁移 + 心跳载荷/机器视图嵌套 schema（None=清除语义）'
title_zh: 'backend 数据层——Machine.sillyspec_status JSON 列 + add_machine_sillyspec_status 迁移 + 心跳载荷/机器视图嵌套 schema（None=清除语义）'
author: 'qinyi'
created_at: 2026-09-03 08:46:38
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-05, FR-07]
decision_ids: [D-B1@v1]
related_tests:
  - backend/app/modules/daemon/tests/test_machine_sillyspec.py
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/router.py
  - backend/migrations/versions/20260903090000_add_machine_sillyspec_status.py
  - backend/app/modules/daemon/tests/test_machine_sillyspec.py
goal: >
  daemon_instances 加 sillyspec_status JSON 列（None=清除语义，锚定 sillyspec_update 权威注释）
  + add_machine_sillyspec_status 迁移 + 心跳载荷 sillyspec_status 摘要字段与机器视图嵌套读取模型
  （design §4 数据契约 / §5 backend 段，D-B1@v1=Grill B1 修订 None=清除），为 task-03 心跳落库
  与机器视图透出、task-02 daemon 上报打数据地基（FR-05；schema 变更触发 task-05 的 FR-07
  类型再生成）。
implementation:
  - model.py DaemonInstance 仿 sillyspec_update（:111-114）追加 sillyspec_status 列（dict | None，Field(default=None) + sa_column=Column(JSON, nullable=True) 同款写法）；注释锚定 2026-09-02-changes-overview-card FR-05 / Grill B1——心跳载荷该键为 null 即置 NULL（None=清除，语义同 sillyspec_update 权威注释 model.py:106-110 / router.py:307-310）；NULL=总览不可用（sillyspec 未安装或版本过低）
  - 新迁移 20260903090000_add_machine_sillyspec_status.py——down_revision 取执行时 alembic heads 唯一 head（写卡时最新时间戳迁移为 20260902120000_group_member_last_read，实跑以 alembic heads 为准，撞车 re-parent）；upgrade 单个 op.add_column（daemon_instances 加 sa.JSON nullable 列），downgrade 对称 drop；结构照 20260831150000_add_daemon_sillyspec_fields.py 先例
  - router.py 心跳内联 DTO 段（:230-310）——新内联 BaseModel DaemonHeartbeatSillySpecStatus 承载 design §4 摘要（ok / errors_count / warnings_count / generated_at / active_changes / healthy_count / ghost_count / conflict_count / conflict_types / changes[] 每项含 name、ghost、current_stage、stage_label、last_active、steps / pending_conflicts[]），字段全可选、宁宽勿断不收紧 Literal（DaemonHeartbeatSillySpecUpdate :260 先例）；心跳请求模型追加 sillyspec_status 可选字段（DaemonHeartbeatSillySpecStatus | None，default=None——旧 daemon 无该键心跳照常通过，Pydantic 忽略未知字段，NFR-01）
  - router.py 机器视图内联读取段（:603-677）——新 MachineSillySpecStatusRead（design §4 摘要宽松透出，MachineSillySpecUpdateRead :626 先例）+ DaemonMachineReadWithPending 追加 sillyspec_status 可选嵌套字段（MachineSillySpecStatusRead | None = None）；_build_machine_read 组装接线与心跳 handler 落库归 task-03
  - 落点说明——design §5「schema.py」措辞按模块既有内联先例落 router.py（心跳 DTO task-07 内联先例 :230 / 机器视图扩展「不动 schema.py」边界注释 :603-609），schema.py 保持零改动
  - test_machine_sillyspec.py 既有迁移/列/载荷断言若受新列影响同步修正（仅扩字段不改用例语义，新增用例归 task-03）
acceptance:
  - daemon_instances.sillyspec_status JSON nullable 列存在；迁移 upgrade/downgrade 可逆，alembic heads 单 head
  - 心跳内联模型含 sillyspec_status 可选字段（default=None，旧 daemon 无键心跳照常通过）
  - MachineSillySpecStatusRead 与 DaemonMachineReadWithPending.sillyspec_status 嵌套读取模型就位（进入 OpenAPI，供 task-05 pnpm gen:types 生成前端类型）
  - test_machine_sillyspec.py 既有用例零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_machine_sillyspec.py -q --no-cov
  - cd backend && uv run alembic heads
  - cd backend && uv run ruff check app/modules/daemon migrations/versions/20260903090000_add_machine_sillyspec_status.py && uv run ruff format --check app/modules/daemon/model.py app/modules/daemon/router.py migrations/versions/20260903090000_add_machine_sillyspec_status.py
constraints:
  - 只做数据层（列 + 迁移 + DTO/读取模型定义）；心跳 handler 落库、_build_machine_read 组装接线与新增单测归 task-03（router.py 两任务按段分工，允许路径重叠）
  - 摘要字段宁宽勿断——不收紧 Literal、不做截断（32KB 预算与 changes N=50 截断在 daemon 侧 task-02 执行，backend JSON 原样落库）
  - 不动 sillyspec_version / sillyspec_latest_version / sillyspec_update 既有语义；不动 schema.py；迁移只加列不回填
  - openapi.json 与 api-types.ts 再生成归 task-05（FR-07 落点，本卡不跑 gen:types）
provides:
  - contract: SillySpecStatusHeartbeatSchema
    fields: [sillyspec_status, DaemonHeartbeatSillySpecStatus, MachineSillySpecStatusRead, daemon_instances.sillyspec_status JSON 列]
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
