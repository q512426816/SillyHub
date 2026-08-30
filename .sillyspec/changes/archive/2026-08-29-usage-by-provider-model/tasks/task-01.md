---
id: task-01
title: 'agent_run_model_usage ORM + alembic 迁移（head 接 6756e634f119）'
title_zh: 'agent_run_model_usage ORM + alembic 迁移（head 接 6756e634f119）'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01-1]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/20260829010000_add_agent_run_model_usage.py
goal: >
  新增 AgentRunModelUsage ORM（run_id FK CASCADE + model + 四维 int + api_requests，UNIQUE(run_id,model)）与 alembic 迁移（down_revision=6756e634f119），为用量明细落库提供容器。
implementation:
  - model.py 定义 AgentRunModelUsage（对齐既有 ORM 风格：UUID PK / Field+sa_column / nullable 语义照 design §1.1）
  - 新迁移文件建表 + 唯一索引，down 掉表
acceptance:
  - alembic upgrade head 单 head 无分叉
  - ORM import 进 conftest create_all 可建表（SQLite）
verify:
  - cd backend && uv run alembic heads
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto -k model_usage
constraints:
  - 不动既有表结构；不加回填数据（design §1.2 不回填）
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
