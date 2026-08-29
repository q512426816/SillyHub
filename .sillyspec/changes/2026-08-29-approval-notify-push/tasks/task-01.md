---
id: task-01
title: 'add-notifications-table-model-and-migration'
title_zh: 'notifications 表模型与 Alembic 迁移（含 env.py 登记与建表/回退用例）'
author: 'qinyi'
created_at: 2026-08-29 21:05:09
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/notification/model.py
  - backend/app/modules/notification/__init__.py
  - backend/migrations/versions/
  - backend/migrations/env.py
  - backend/app/modules/notification/tests/__init__.py
  - backend/app/modules/notification/tests/test_model.py
goal: >
  新建 notification 模块的 Notification 表模型（按接收人展开行，D-004@v1）与
  Alembic 建表迁移，并在 migrations/env.py 模型登记清单加行（漏登记 =
  autogenerate 不生成该表，Grill X-16），为 task-02/07/08 的服务与端点提供存储底座。
provides:
  contract: ORM Notification 字段
  fields: [id, workspace_id, recipient_user_id, type, title, body, link, ref_type, ref_id, dedupe_key, read_at, created_at]
implementation:
  - 新建 backend/app/modules/notification/__init__.py 与 model.py，定义 Notification(BaseModel, table=True) 表结构（字段与索引严格按 design.md §8；三个 Index 含 ix_notifications_ref）
  - 在 backend/migrations/env.py 模型登记清单（"Add new modules here" 段）加 import app.modules.notification model 一行
  - 生成 Alembic 迁移 backend/migrations/versions/2026<时间戳>_add_notifications_table.py（建表 + 三索引；down_revision 接当前唯一 head，若多 head 先建 merge revision，参照 merge_parallel_* 先例）；upgrade 建表、downgrade drop_table
  - 写 backend/app/modules/notification/tests/test_model.py 建表/回退用例（upgrade 后表与索引存在、downgrade 后消失，参照既有迁移测试惯例）
acceptance:
  - Notification 模型字段与索引与 design.md §8 完全一致（含 read_at NULL=未读、dedupe_key 无独立索引、无全局唯一约束）
  - migrations/env.py 登记清单含 notification model import
  - alembic upgrade head 建 notifications 表 + 三索引成功，downgrade 一级后表被删除
  - 建表/回退测试通过
verify:
  - cd backend && uv run pytest app/modules/notification -q --no-cov -n auto
  - cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
constraints:
  - 不实现 NotificationService/通道/SSE（task-02/07/08 范围）
  - 不改动既有表结构与既有迁移
  - 不给 dedupe_key 设唯一约束或独立索引（幂等由 service 未消解存在性检查负责，D-009@v2）
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
