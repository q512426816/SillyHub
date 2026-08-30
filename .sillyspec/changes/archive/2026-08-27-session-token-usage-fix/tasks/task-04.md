---
id: task-04
title: 'backend AgentRun.ctx_tokens column + alembic migration'
title_zh: 'backend AgentRun.ctx_tokens 列 + alembic 迁移'
author: 'qinyi'
created_at: 2026-08-27 23:57:01
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-01]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/20260827230000_add_agent_runs_ctx_tokens.py
provides:
  - consumer: task-05
    contract: AgentRun.ctx_tokens 列
    fields: [nullable INT 可写]
goal: >
  agent_runs 加 nullable 整数列 ctx_tokens（run 期间最近一次 API 调用 input+cache_read+cache_creation 之和），模型与 alembic 迁移双落地，为 FR-01 环分子提供落库载体（D-002@v1）；历史 run 保持 NULL → 前端未知态。
implementation:
  - 开工先 `cd backend && uv run alembic heads` 复核唯一 head（2026-08-27 实测 20260826210000；若执行时已漂移，以实测 head 为 down_revision 锚，R-02）
  - backend/app/modules/agent/model.py AgentRun 在 cache_creation_tokens（:295-298）后加列 ctx_tokens（int | None，写法对齐 input_tokens 的 Field(default=None, sa_column=Column(Integer, nullable=True))），注释标注语义与 NULL=老数据/未上报（D-003 未知态）
  - 新建 backend/migrations/versions/20260827230000_add_agent_runs_ctx_tokens.py，revision = "20260827230000"，down_revision = "20260826210000"（执行时实测 head）
  - upgrade 用 op.add_column("agent_runs", sa.Column("ctx_tokens", sa.Integer(), nullable=True))；downgrade 用 op.drop_column("agent_runs", "ctx_tokens")；无回填无换算（NG-04）
acceptance:
  - 模型列定义风格与既有 nullable token 列一致；ruff/mypy 通过
  - alembic heads 仍单 head；upgrade 加列（历史行全 NULL）、downgrade 删列，双向可逆
verify:
  - cd backend && uv run alembic heads
  - cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run ruff check . && uv run mypy app
constraints:
  - nullable 无回填、不迁移历史数据（NG-04）；down_revision 锚执行时唯一 head，不预 merge 多 head
  - 不改既有 token 列语义（NG-01）；不加索引（无该列查询诉求）
  - 本卡只加列，不写提取/写回/读取逻辑（归 task-05），不加测试（归 task-06）
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
