---
id: task-01
title: 'add reported-machine columns and migration'
title_zh: 'platform_agent_logs 机器身份两列 + alembic 迁移'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-30 11:07:12
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/platform_sync/model.py
  - backend/migrations/versions/
  - backend/app/modules/platform_sync/tests/
target_files:
  - backend/app/modules/platform_sync/model.py
  - NEW:backend/migrations/versions/2026xxxx_tool_report_machine.py
provides:
  - contract: AgentSessionLogORM reported machine columns
    fields: [reported_machine_id, reported_machine_name]
goal: >
  给 platform_agent_logs 加 reported_machine_id/reported_machine_name 两列（nullable）并出 alembic 迁移，为上报机器身份落库与 takeover 匹配提供存储基础（FR-01/D-001@v1）。
implementation:
  - backend/app/modules/platform_sync/model.py AgentSessionLogORM 加 reported_machine_id varchar(64) NULL / reported_machine_name varchar(255) NULL 两列（对齐既有列注释惯例，注明 2026-09-30-tool-report 变更来源）
  - 生成 alembic 迁移（alembic revision，版本号随迁移链接续；仅两列 add_column，无唯一约束——hostname 允许多条上报）
  - 模型层单测（platform_sync/tests 追加：两列默认 NULL、与既有 uq_platform_agent_logs_workspace_path 唯一约束共存）
acceptance:
  - alembic upgrade head 在空库与现网结构库均成功（迁移链无断裂）
  - AgentSessionLogORM 新列 nullable，老行读取不报错（默认 NULL）
  - platform_sync 相关 pytest 通过
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests -q --no-cov
constraints:
  - 不改 agent_sessions 表（design 数据模型：会话级机器走 config_snapshot 快照）
  - 迁移仅加列，禁止数据回填与唯一约束
  - 列名/长度逐字按 design 数据模型节（varchar 64/255）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
