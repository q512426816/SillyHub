---
id: task-02
title: 'backend daemon_instances.pending_update 列 + alembic 迁移'
title_zh: 'backend daemon_instances.pending_update 列 + alembic 迁移'
author: 'qinyi'
created_at: 2026-08-29 15:04:03
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/migrations/versions/202608291500_add_daemon_pending_update.py
  - backend/app/modules/daemon/tests/test_pending_update_column.py
goal: >
  backend daemon_instances 新增 pending_update 列（JSON nullable，NULL=无待升级）并配 alembic 可逆迁移，
  为心跳 upsert 与机器视图透出（task-06/task-07）打存储地基——FR-04 / D-004@v1 三端透传的数据层。
implementation:
  - model.py DaemonInstance 照 capabilities 先例（model.py:80-83）加 pending_update——dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))，注释标注 FR-04/D-004@v1 与 NULL=无 pending 语义
  - 新迁移 202608291500_add_daemon_pending_update.py（文件名具体化，不用 rev 占位）——down_revision 填执行时 alembic heads 唯一 head（写卡时为 4766d997cf09，已变则以实跑为准并 re-parent，design R5）；upgrade 用 op.add_column 加 JSON nullable 列，downgrade 用 op.drop_column；结构照 20260805110000_daemon_started_at.py 先例
  - 新增 backend/app/modules/daemon/tests/test_pending_update_column.py——覆盖列存在、默认 NULL、JSON dict 写读往返、upgrade/downgrade 可逆（夹具照本目录 conftest 既有风格）
acceptance:
  - daemon_instances.pending_update 列存在，JSON 类型、nullable、存量与新行默认 NULL
  - 迁移 upgrade/downgrade 幂等可逆；alembic heads 输出单 head
  - 新测试全绿；daemon 模块既有测试零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_pending_update_column.py -q --no-cov
  - cd backend && uv run alembic heads
constraints:
  - 只加列+迁移+测试，不做心跳落库与 machines/runtimes/page 透出（归 task-06）
  - 迁移文件名固定 202608291500_add_daemon_pending_update.py；提交前必须单 head 检查，撞车 re-parent（本仓 merge 迁移先例）
  - 不改 capabilities 等既有列语义；since 保留与 upsert 清除逻辑归 task-06，本任务不做数据回填
provides:
  - contract: PendingUpdateColumn
    fields: [pending_update]
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
