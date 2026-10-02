---
id: task-01
title: '存储层迁移——migration 20261002010000 + AgentSessionLogORM 加 5 列用量快照（可 up/down）'
title_zh: '存储层迁移——migration 20261002010000 + AgentSessionLogORM 加 5 列用量快照（可 up/down）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-02 23:14:36
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/migrations/versions/20261002010000_add_platform_agent_log_usage.py
  - backend/app/modules/platform_sync/model.py
target_files:
  - NEW:backend/migrations/versions/20261002010000_add_platform_agent_log_usage.py
  - backend/app/modules/platform_sync/model.py
provides:
  - contract: platform_agent_logs 快照五列
    fields: [usage_input_tokens, usage_output_tokens, usage_cache_read_tokens, usage_cache_write_tokens, usage_parsed_at]
goal: >
  platform_agent_logs 加 5 列用量快照（四维 token + usage_parsed_at），为摄取链路（task-02）与
  聚合本地段（task-03）提供存储基础；可 up/down 回退（FR-04 兼容策略）。
implementation:
  - 新建 alembic 迁移 20261002010000_add_platform_agent_log_usage.py：add_column platform_agent_logs 五列——usage_input_tokens/usage_output_tokens/usage_cache_read_tokens/usage_cache_write_tokens 均 sa.BigInteger() nullable、usage_parsed_at sa.DateTime(timezone=True) nullable；downgrade 对称 drop（对齐 backend/migrations/versions/20260829010000_add_agent_run_model_usage.py 先例）
  - backend/app/modules/platform_sync/model.py AgentSessionLogORM（:229 起）加同名 5 列 Mapped[...]，注释声明 producer=摄取任务 / consumer=change 聚合 + 「快照覆盖写幂等，NULL=未摄取」语义；usage_cache_write_tokens 注释锚定 daemon 侧 cacheWriteTokens ↔ run 侧 cache_creation_tokens 映射链
acceptance:
  - uv run alembic upgrade head 后五列存在且全部 nullable；downgrade -1 后五列消失
  - ORM 列名/类型与迁移一致（mypy 通过，无模型-迁移漂移）
verify:
  - cd backend && uv run ruff check app/modules/platform_sync/model.py && uv run mypy app
constraints:
  - 不写摄取/聚合逻辑（归 task-02/03）；不动 platform_agent_logs 既有列
  - 旧行五列恒 NULL，不回填（design 非目标）
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
