---
id: task-01
title: '后端数据模型——agent_session_task 表 + Alembic migration（含 run_id 索引、(session_id,task_id) 唯一约束、会话级联删除）'
title_zh: '后端数据模型——agent_session_task 表 + Alembic migration（含 run_id 索引、(session_id,task_id) 唯一约束、会话级联删除）'
author: 'qinyi'
created_at: 2026-09-05 00:19:48
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-006@v1]
provides:
  - contract: agent_session_task
    fields: [session_id, run_id, task_id, status, started_at, finished_at]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/migrations/versions/
goal: >
  在 daemon/model.py 新增 AgentSessionTask 表（agent_session_task，承载 agent 任务状态服务端持久化）
  并配套 Alembic 建表迁移，为刷新/切会话不丢任务记录（FR-05）提供存储基座，供 task-02 快照端点与
  task-03 upsert 写入消费。
implementation:
  - model.py 照 DaemonTaskLease（model.py:340）与 SessionDialogRequest（model.py:249）先例新增 AgentSessionTask(BaseModel, table=True)，__tablename__ = "agent_session_task"，UUID 主键 default_factory=uuid.uuid4，逐列 sa_column=Column(...) 显式声明
  - 列清单按 design §数据模型逐项落——id；session_id（FK agent_sessions.id ondelete CASCADE，随会话删除级联清理）；run_id（UUID not null，仅建索引不建硬 FK，避免与 agent_runs 删除链耦合）；task_id str(255)；task_name str(512)；status str（running/completed/failed/stopped）；progress int null（事件契约 int 类型，当前恒 null，列保留对齐契约防漂移）；summary TEXT null（「正在做什么」摘要，逐次覆盖）；message TEXT null（终态消息）；last_tool_name str(255) null；tool_use_id str(255) null；elapsed_ms int null；total_tokens int null；tool_uses int null；is_async bool default false（对齐事件契约 async，schema.py:1253）；started_at timestamptz null（首次插入置 now）；finished_at timestamptz null（终态置 now）；created_at/updated_at timestamptz（default_factory 取 datetime.now(UTC) + server_default now()，同表内既有惯例）
  - __table_args__ 落 UniqueConstraint("session_id", "task_id")（upsert 定位键）+ 单列 Index session_id、run_id（run_id 支撑后续按 run 分组增强）；模型与迁移两侧同语义（grants/model.py 先例注释口径）
  - 新增 backend/migrations/versions/<时间戳>_add_agent_session_task.py 建表迁移——结构照 20260903170000_add_group_chat_archived_at.py 先例（文件头 docstring 注明变更/任务/列语义），upgrade 建表+唯一约束+索引，downgrade 对称 drop_table
  - down_revision 锚定执行时 uv run alembic heads 实测的当前 head（卡片撰写时为 20260903170000 单 head；执行时以实测为准，R-02 防并行变更撞 head）
  - 表 docstring 注明数据流（producer=上报端点 upsert，consumer=GET 快照端点）与「不做逐事件流水表、upsert 单行控写放大」（R-03）
acceptance:
  - uv run alembic heads 单 head；upgrade head 建表成功，downgrade -1 再 upgrade head 往返成功
  - 表结构与 design §数据模型逐列一致——(session_id, task_id) 唯一约束、session_id/run_id 索引、session_id FK ondelete CASCADE 齐全
  - 模型与迁移两侧的列类型/约束/索引语义一致（对照 grants 先例口径）
  - ruff check 与 ruff format --check 通过（model.py + 新迁移文件）
verify:
  - cd backend && uv run alembic heads && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run ruff check app/modules/daemon/model.py migrations/versions/ && uv run ruff format --check app/modules/daemon/model.py migrations/versions/
constraints:
  - 行为测试归 task-04，本卡不新增测试（CLAUDE.md 规则 0，禁止跑全量）
  - down_revision 不硬编码卡片撰写时点值，执行时必须实测 alembic heads 后锚定（R-02 并行撞 head 已知坑）
  - 不建 run_id 对 agent_runs 的硬外键（design §数据模型明确）；代码 Windows 兼容（不用平台专属路径/shell 调用）
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
