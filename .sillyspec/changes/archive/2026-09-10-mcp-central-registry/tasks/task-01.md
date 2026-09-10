---
id: task-01
title: add-mcp-registry-tables-and-dtos
title_zh: 数据层——三表 ORM、Alembic 迁移与全套 DTO
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001, D-002, D-005]
allowed_paths:
  - backend/app/modules/mcp_registry/
  - backend/migrations/versions/
target_files:
  - NEW:backend/app/modules/mcp_registry/model.py
  - NEW:backend/app/modules/mcp_registry/schema.py
  - NEW:backend/app/modules/mcp_registry/tests/test_model_schema.py
  - NEW:backend/migrations/versions/20260910140000_add_mcp_registry_tables.py
provides:
  - contract: mcp_registry 数据模型
    fields: [McpServer, McpServerBinding, McpTemplate]
  - contract: McpServerCreate
    fields: [name, server_config, scope, source, dedup_key]
  - contract: McpServerDetail
    fields: [server_config, encrypted_env]
  - contract: McpImportRequest
    fields: [json_text, scope]
  - contract: McpWorkspaceCandidate
    fields: [name, server_config, workspace_id, dedup_verdict]
  - contract: McpTemplateRead
    fields: [name, server_config, is_preset]
goal: 建 mcp_registry 数据层——三表 ORM、Alembic 迁移（三条唯一索引含对称 downgrade）与全套 DTO，为 service/render/importer 提供字段权威实体。
implementation:
  - 照 skills 与 llm_provider 模块惯例新建 mcp_registry 包（含模块与 tests 两级 __init__），本 task 只落 model、schema 与迁移
  - model.py 三表字段逐项对照 design 数据模型节——owner_user_id 可空 FK users ON DELETE CASCADE、server_config/encrypted_env/tags 均 JSON、name String(100)、server_type 默认 stdio、dedup_key/source/enabled/note/created_at/updated_at，Column 风光照 llm_provider/model.py；唯一性三条——uq_mcp_servers_owner_name 为 COALESCE(owner_user_id, 全零 sentinel uuid) 加 name 的函数唯一索引，uq_binding_platform 与 uq_binding_user 为 scope_type 条件 partial unique index，ORM 与迁移双侧一致
  - schema.py 全套 DTO（创建/更新输入、列表/详情脱敏输出、binding 操作、导入、诊断、模板），env 脱敏沿用 settings/router 的 _SECRET_KEY_MARKERS 四标记子串规则；encrypted_env 定为逐键密文信封，每键含 ct（base64 密文）与 key_id（版本标签）两字段
  - Alembic 迁移落 backend/migrations/versions（design 清单写 alembic/versions 系笔误，仓库实际为 migrations/versions），时间戳 revision 命名，down_revision 对齐执行时 head（现 20260910120000），downgrade 对称 drop 三表三索引
  - 单测 test_model_schema.py 覆盖模型默认值、DTO 脱敏行为与 encrypted_env 信封结构
acceptance:
  - alembic upgrade 建出三表与三条唯一索引，downgrade 对称回落
  - 三表字段与 design 数据模型节逐字段一致无发明，DTO 全套齐全且列表/详情 env 中 secret 键输出脱敏占位
  - encrypted_env 每键结构含 ct 与 key_id，与 design Grill CC-03 规格一致
verify:
  - cd backend && uv run pytest app/modules/mcp_registry/tests/test_model_schema.py -q
  - cd backend && uv run ruff check app/modules/mcp_registry migrations/versions && uv run mypy app/modules/mcp_registry
constraints:
  - 测试只跑本 task 相关路径，禁止全量测试（CLAUDE.md 规则 0）
  - 迁移必须带 downgrade；字段名与索引名来自 design 数据模型节不发明
  - server_type 仅建模预留枚举，stdio-only 写路径校验属 task-02；本 task 不实现 service/router/render/importer
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
